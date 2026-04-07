import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  decodePluginManifest,
  decodePluginUiScreen,
  executePluginAction,
  openPluginStream,
} from "@scout/plugin-sdk"
import { agent } from "../src/agent.js"
import {
  DOCKER_ACTION_IDS,
  DOCKER_ENTITY_KINDS,
  DOCKER_FEATURES,
  DOCKER_PLUGIN_ID,
  DOCKER_STREAM_IDS,
} from "../src/contracts.js"
import {
  createDockerAgentPlugin,
  parseDockerIdList,
  parseDockerInspectArray,
  parseDockerJsonObject,
  parseDockerStatsLines,
  type CommandResult,
  type DockerDependencies,
} from "../src/docker.js"
import { manifest } from "../src/manifest.js"
import { web } from "../src/web.js"

const makeDeps = (
  commandResults: Record<string, CommandResult | Error>,
  streams?: {
    readonly logs?: Stream.Stream<{ readonly lines: ReadonlyArray<string>; readonly ts: number }, Error>
  },
): DockerDependencies => ({
  exec: (command, args) => {
    const key = `${command} ${args.join(" ")}`
    const result = commandResults[key]

    if (result === undefined) {
      return Effect.fail(new Error(`unexpected command: ${key}`))
    }

    return result instanceof Error ? Effect.fail(result) : Effect.succeed(result)
  },
  followLogs: () =>
    streams?.logs ?? Stream.fail(new Error("unexpected followLogs call")),
})

describe("docker plugin", () => {
  it("exports a manifest compatible with the plugin SDK", async () => {
    const decoded = await Effect.runPromise(decodePluginManifest(manifest))

    expect(decoded.id).toBe(DOCKER_PLUGIN_ID)
    expect(decoded.entityKinds.map((entity) => entity.id)).toEqual(
      expect.arrayContaining([
        DOCKER_ENTITY_KINDS.daemon,
        DOCKER_ENTITY_KINDS.container,
        DOCKER_ENTITY_KINDS.image,
      ]),
    )
    expect(decoded.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([
        DOCKER_ACTION_IDS.startContainer,
        DOCKER_ACTION_IDS.stopContainer,
      ]),
    )
  })

  it("detects Docker capability on a Docker-capable host", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps({
        "docker --version": {
          stdout: "Docker version 27.1.0, build deadbeef\n",
          stderr: "",
          exitCode: 0,
        },
        "docker info --format {{json .}}": {
          stdout: JSON.stringify({
            ID: "daemon-1",
            Name: "builder-01",
          }),
          stderr: "",
          exitCode: 0,
        },
      }),
    )

    await expect(
      Effect.runPromise(plugin.detect({ nodeId: "node-1", now: 1 })),
    ).resolves.toEqual({
      pluginId: DOCKER_PLUGIN_ID,
      version: manifest.version,
      status: "available",
      features: [...DOCKER_FEATURES],
    })
  })

  it("returns unsupported when Docker is not installed", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps({
        "docker --version": new Error("spawn docker ENOENT"),
      }),
    )

    await expect(
      Effect.runPromise(plugin.detect({ nodeId: "node-1", now: 1 })),
    ).resolves.toMatchObject({
      pluginId: DOCKER_PLUGIN_ID,
      status: "unsupported",
      reason: "docker CLI not found on node",
    })
  })

  it("collects daemon, containers, images, volumes, and networks with relationships", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps({
        "docker info --format {{json .}}": {
          stdout: JSON.stringify({
            ID: "daemon-1",
            Name: "builder-01",
            ServerVersion: "27.1.0",
            OperatingSystem: "Docker Desktop",
            OSType: "linux",
            Architecture: "aarch64",
            KernelVersion: "6.6.0",
            DockerRootDir: "/var/lib/docker",
            Driver: "overlay2",
            NCPU: 8,
            MemTotal: 17179869184,
            Containers: 2,
            ContainersRunning: 1,
            ContainersPaused: 0,
            ContainersStopped: 1,
            Images: 2,
          }),
          stderr: "",
          exitCode: 0,
        },
        "docker container ls --all --quiet --no-trunc": {
          stdout: "cont-web\ncont-worker\n",
          stderr: "",
          exitCode: 0,
        },
        "docker image ls --quiet --no-trunc": {
          stdout: "sha256:img-nginx\nsha256:img-app\nsha256:img-nginx\n",
          stderr: "",
          exitCode: 0,
        },
        "docker volume ls --quiet": {
          stdout: "data\ncache\n",
          stderr: "",
          exitCode: 0,
        },
        "docker network ls --quiet --no-trunc": {
          stdout: "net-front\nnet-bridge\n",
          stderr: "",
          exitCode: 0,
        },
        "docker container inspect cont-web cont-worker": {
          stdout: JSON.stringify([
            {
              Id: "cont-web",
              Name: "/web",
              Created: "2026-04-06T09:00:00Z",
              Image: "sha256:img-nginx",
              Config: {
                Hostname: "web",
                Image: "nginx:1.27",
                Labels: {
                  service: "frontend",
                },
              },
              State: {
                Status: "running",
                Running: true,
                Paused: false,
                Restarting: false,
                OOMKilled: false,
                Dead: false,
                ExitCode: 0,
                StartedAt: "2026-04-06T09:00:01Z",
                FinishedAt: "0001-01-01T00:00:00Z",
                Health: {
                  Status: "healthy",
                },
              },
              HostConfig: {
                NetworkMode: "front-net",
              },
              Mounts: [
                {
                  Type: "volume",
                  Name: "data",
                  Source: "/var/lib/docker/volumes/data/_data",
                  Destination: "/usr/share/nginx/html",
                  RW: true,
                },
              ],
              NetworkSettings: {
                Networks: {
                  "front-net": {
                    NetworkID: "net-front",
                    IPAddress: "172.18.0.2",
                    Gateway: "172.18.0.1",
                    Aliases: ["web"],
                  },
                },
              },
            },
            {
              Id: "cont-worker",
              Name: "/worker",
              Created: "2026-04-06T08:30:00Z",
              Image: "sha256:img-app",
              Config: {
                Hostname: "worker",
                Image: "acme/app:latest",
                Labels: {
                  service: "worker",
                },
              },
              State: {
                Status: "exited",
                Running: false,
                Paused: false,
                Restarting: false,
                OOMKilled: false,
                Dead: false,
                ExitCode: 137,
                StartedAt: "2026-04-06T08:30:01Z",
                FinishedAt: "2026-04-06T08:55:00Z",
              },
              HostConfig: {
                NetworkMode: "bridge",
              },
              Mounts: [
                {
                  Type: "volume",
                  Name: "cache",
                  Source: "/var/lib/docker/volumes/cache/_data",
                  Destination: "/cache",
                  RW: false,
                },
              ],
              NetworkSettings: {
                Networks: {
                  bridge: {
                    NetworkID: "net-bridge",
                    IPAddress: "172.17.0.2",
                    Gateway: "172.17.0.1",
                    Aliases: [],
                  },
                },
              },
            },
          ]),
          stderr: "",
          exitCode: 0,
        },
        "docker image inspect sha256:img-nginx sha256:img-app": {
          stdout: JSON.stringify([
            {
              Id: "sha256:img-nginx",
              RepoTags: ["nginx:1.27"],
              RepoDigests: ["nginx@sha256:111"],
              Created: "2026-04-05T00:00:00Z",
              Size: 2048,
              SharedSize: 0,
              VirtualSize: 2048,
              Architecture: "arm64",
              Os: "linux",
              Config: {
                Labels: {
                  vendor: "nginx",
                },
              },
            },
            {
              Id: "sha256:img-app",
              RepoTags: ["acme/app:latest"],
              RepoDigests: ["acme/app@sha256:222"],
              Created: "2026-04-04T00:00:00Z",
              Size: 4096,
              SharedSize: 0,
              VirtualSize: 4096,
              Architecture: "arm64",
              Os: "linux",
              Parent: "sha256:img-base",
              Config: {
                Labels: {
                  vendor: "acme",
                },
              },
            },
          ]),
          stderr: "",
          exitCode: 0,
        },
        "docker volume inspect data cache": {
          stdout: JSON.stringify([
            {
              Name: "data",
              Driver: "local",
              CreatedAt: "2026-04-05T10:00:00Z",
              Labels: {
                backup: "daily",
              },
              Mountpoint: "/var/lib/docker/volumes/data/_data",
              Scope: "local",
              Options: {
                o: "bind",
              },
              UsageData: {
                Size: 1024,
                RefCount: 1,
              },
            },
            {
              Name: "cache",
              Driver: "local",
              CreatedAt: "2026-04-05T11:00:00Z",
              Labels: null,
              Mountpoint: "/var/lib/docker/volumes/cache/_data",
              Scope: "local",
              UsageData: {
                Size: 512,
                RefCount: 1,
              },
            },
          ]),
          stderr: "",
          exitCode: 0,
        },
        "docker network inspect net-front net-bridge": {
          stdout: JSON.stringify([
            {
              Id: "net-front",
              Name: "front-net",
              Driver: "bridge",
              Scope: "local",
              Internal: false,
              EnableIPv6: false,
              Labels: {
                team: "web",
              },
              Created: "2026-04-05T12:00:00Z",
              IPAM: {
                Driver: "default",
                Config: [
                  {
                    Subnet: "172.18.0.0/16",
                    Gateway: "172.18.0.1",
                  },
                ],
              },
            },
            {
              Id: "net-bridge",
              Name: "bridge",
              Driver: "bridge",
              Scope: "local",
              Internal: false,
              EnableIPv6: false,
              Labels: null,
              Created: "2026-04-05T12:30:00Z",
              IPAM: {
                Driver: "default",
                Config: [
                  {
                    Subnet: "172.17.0.0/16",
                    Gateway: "172.17.0.1",
                  },
                ],
              },
            },
          ]),
          stderr: "",
          exitCode: 0,
        },
        "docker container stats --no-stream --format {{json .}} cont-web": {
          stdout: [
            JSON.stringify({
              ID: "cont-web",
              Name: "web",
              CPUPerc: "12.5%",
              MemUsage: "128MiB / 1GiB",
              NetIO: "10MB / 5MB",
            }),
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        },
      }),
    )

    const result = await Effect.runPromise(
      plugin.collect!({ nodeId: "node-1", now: 42 }),
    )

    expect(result.entities).toHaveLength(9)

    const daemon = result.entities?.find((entity) => entity.ref.kind === DOCKER_ENTITY_KINDS.daemon)
    const webContainer = result.entities?.find((entity) => entity.ref.id === "cont-web")
    const workerContainer = result.entities?.find((entity) => entity.ref.id === "cont-worker")
    const nginxImage = result.entities?.find((entity) => entity.ref.id === "sha256:img-nginx")
    const dataVolume = result.entities?.find((entity) => entity.ref.id === "data")
    const frontNetwork = result.entities?.find((entity) => entity.ref.id === "net-front")

    expect(daemon).toMatchObject({
      ref: {
        pluginId: DOCKER_PLUGIN_ID,
        kind: DOCKER_ENTITY_KINDS.daemon,
        nodeId: "node-1",
        id: "daemon-1",
      },
      status: "running",
      displayName: "builder-01",
      state: {
        containersRunning: 1,
        containersStopped: 1,
        images: 2,
      },
    })

    expect(webContainer).toMatchObject({
      ref: {
        pluginId: DOCKER_PLUGIN_ID,
        kind: DOCKER_ENTITY_KINDS.container,
        nodeId: "node-1",
        id: "cont-web",
      },
      displayName: "web",
      status: "running",
      labels: {
        service: "frontend",
      },
      relationships: expect.arrayContaining([
        {
          type: "managed-by",
          target: daemon?.ref,
        },
        {
          type: "uses-image",
          target: {
            pluginId: DOCKER_PLUGIN_ID,
            kind: DOCKER_ENTITY_KINDS.image,
            nodeId: "node-1",
            id: "sha256:img-nginx",
          },
        },
        {
          type: "mounts-volume",
          target: {
            pluginId: DOCKER_PLUGIN_ID,
            kind: DOCKER_ENTITY_KINDS.volume,
            nodeId: "node-1",
            id: "data",
          },
        },
        {
          type: "attached-to-network",
          target: {
            pluginId: DOCKER_PLUGIN_ID,
            kind: DOCKER_ENTITY_KINDS.network,
            nodeId: "node-1",
            id: "net-front",
          },
        },
      ]),
    })

    expect(workerContainer).toMatchObject({
      displayName: "worker",
      status: "exited",
    })

    expect(nginxImage).toMatchObject({
      ref: {
        kind: DOCKER_ENTITY_KINDS.image,
        id: "sha256:img-nginx",
      },
      displayName: "nginx:1.27",
      relationships: expect.arrayContaining([
        {
          type: "managed-by",
          target: daemon?.ref,
        },
        {
          type: "used-by-container",
          target: webContainer?.ref,
        },
      ]),
    })

    expect(dataVolume).toMatchObject({
      ref: {
        kind: DOCKER_ENTITY_KINDS.volume,
        id: "data",
      },
      status: "in-use",
      relationships: expect.arrayContaining([
        {
          type: "managed-by",
          target: daemon?.ref,
        },
        {
          type: "mounted-by-container",
          target: webContainer?.ref,
        },
      ]),
    })

    expect(frontNetwork).toMatchObject({
      ref: {
        kind: DOCKER_ENTITY_KINDS.network,
        id: "net-front",
      },
      displayName: "front-net",
      state: {
        connectedContainers: 1,
      },
      relationships: expect.arrayContaining([
        {
          type: "managed-by",
          target: daemon?.ref,
        },
        {
          type: "connected-container",
          target: webContainer?.ref,
        },
      ]),
    })

    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: DOCKER_PLUGIN_ID,
          metricId: "containers.running",
          entity: daemon?.ref,
          value: 1,
        }),
        expect.objectContaining({
          pluginId: DOCKER_PLUGIN_ID,
          metricId: "container.cpu.percent",
          entity: webContainer?.ref,
          value: 12.5,
        }),
        expect.objectContaining({
          pluginId: DOCKER_PLUGIN_ID,
          metricId: "container.memory.usage.bytes",
          entity: webContainer?.ref,
          value: 134217728,
        }),
        expect.objectContaining({
          pluginId: DOCKER_PLUGIN_ID,
          metricId: "container.network.rx.bytes",
          entity: webContainer?.ref,
          value: 10000000,
        }),
        expect.objectContaining({
          pluginId: DOCKER_PLUGIN_ID,
          metricId: "container.restarts",
          entity: workerContainer?.ref,
          value: 0,
        }),
      ]),
    )
  })

  it("returns an empty inventory on non-Docker hosts", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps({
        "docker info --format {{json .}}": new Error("spawn docker ENOENT"),
      }),
    )

    await expect(
      Effect.runPromise(plugin.collect!({ nodeId: "node-1", now: 42 })),
    ).resolves.toEqual({ entities: [] })
  })

  it("exports JSON-rendered screens for the web", async () => {
    expect(web.screens).toHaveLength(4)
    expect(web.screens.map((screen) => screen.id)).toEqual(
      expect.arrayContaining(["docker.overview", "docker.container-detail"]),
    )

    await Promise.all(web.screens.map((screen) => Effect.runPromise(decodePluginUiScreen(screen))))

    const containerDetail = web.screens.find((screen) => screen.id === "docker.container-detail")

    expect(containerDetail?.kind).toBe("entity-detail")
    expect(containerDetail?.spec.root).toBe("page")
    expect(containerDetail?.spec.elements["container-actions"]?.props).toMatchObject({
      title: "Container Actions",
    })
    expect(containerDetail?.spec.elements["container-logs"]?.props).toMatchObject({
      streamId: DOCKER_STREAM_IDS.containerLogs,
      targetEntityStatePath: "/selectedEntity",
    })
  })

  it("parses Docker CLI helpers safely", () => {
    expect(parseDockerIdList("a\nb\na\n\n")).toEqual(["a", "b"])
    expect(parseDockerInspectArray('[{"Id":"one"}]')).toEqual([{ Id: "one" }])
    expect(parseDockerInspectArray("not json")).toEqual([])
    expect(parseDockerJsonObject<{ Name: string }>('{"Name":"builder-01"}')).toEqual({
      Name: "builder-01",
    })
    expect(parseDockerJsonObject<{ Name: string }>("[]")).toBeNull()
    expect(parseDockerStatsLines('{"ID":"one","CPUPerc":"10%"}\n{"ID":"two","CPUPerc":"20%"}')).toEqual([
      { ID: "one", CPUPerc: "10%" },
      { ID: "two", CPUPerc: "20%" },
    ])
  })

  it("re-exports the default agent plugin", async () => {
    const detected = await Effect.runPromise(agent.detect({ nodeId: "node-1", now: 1 }))

    expect(detected).toMatchObject({
      pluginId: DOCKER_PLUGIN_ID,
    })
  })

  it("executes Docker actions through the generic plugin action runtime", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps({
        "docker container start cont-web": {
          stdout: "cont-web\n",
          stderr: "",
          exitCode: 0,
        },
        "docker container inspect cont-web": {
          stdout: JSON.stringify([
            {
              Id: "cont-web",
              Name: "/web",
              State: {
                Status: "running",
              },
            },
          ]),
          stderr: "",
          exitCode: 0,
        },
      }),
    )

    const pkg = { manifest, agent: plugin }
    const target = {
      nodeId: "node-1",
      entity: {
        pluginId: DOCKER_PLUGIN_ID,
        kind: DOCKER_ENTITY_KINDS.container,
        nodeId: "node-1",
        id: "cont-web",
      },
    } as const

    const started = await Effect.runPromise(
      executePluginAction(pkg, { nodeId: "node-1", permissions: new Set(manifest.permissions) }, {
        pluginId: DOCKER_PLUGIN_ID,
        actionId: DOCKER_ACTION_IDS.startContainer,
        target,
        input: {},
      }),
    )

    const inspected = await Effect.runPromise(
      executePluginAction(pkg, { nodeId: "node-1", permissions: new Set(manifest.permissions) }, {
        pluginId: DOCKER_PLUGIN_ID,
        actionId: DOCKER_ACTION_IDS.inspectContainer,
        target,
        input: {},
      }),
    )

    expect(started.output).toEqual({ stdout: "cont-web" })
    expect(inspected.output).toEqual({
      payload: {
        Id: "cont-web",
        Name: "/web",
        State: {
          Status: "running",
        },
      },
    })
  })

  it("opens Docker log streams through the generic stream runtime", async () => {
    const plugin = createDockerAgentPlugin(
      makeDeps(
        {},
        {
          logs: Stream.fromIterable([
            { lines: ["line one", "line two"], ts: 1 },
          ]),
        },
      ),
    )

    const pkg = { manifest, agent: plugin }
    const target = {
      nodeId: "node-1",
      entity: {
        pluginId: DOCKER_PLUGIN_ID,
        kind: DOCKER_ENTITY_KINDS.container,
        nodeId: "node-1",
        id: "cont-web",
      },
    } as const

    const logStream = await Effect.runPromise(
      openPluginStream(pkg, { nodeId: "node-1", permissions: new Set(manifest.permissions) }, {
        pluginId: DOCKER_PLUGIN_ID,
        streamId: "container.logs",
        target,
        input: { tail: 50 },
      }),
    )

    const logChunks: Array<unknown> = []

    await Effect.runPromise(Stream.runForEach(logStream, (chunk) => Effect.sync(() => {
      logChunks.push(chunk)
    })))

    expect(logChunks).toEqual([{ lines: ["line one", "line two"], ts: 1 }])
  })
})
