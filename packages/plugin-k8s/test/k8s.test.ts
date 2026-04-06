import { Effect, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { decodePluginManifest, executePluginAction, openPluginStream } from "@scout/plugin-sdk"
import {
  K8S_ACTION_IDS,
  K8S_ENTITY_KINDS,
  K8S_PLUGIN_ID,
  K8S_STREAM_IDS,
} from "../src/contracts.js"
import { createK8sAgentPlugin, materializeK8sCollection } from "../src/k8s.js"
import { manifest } from "../src/manifest.js"
import { web } from "../src/web.js"
import { createKubectlExecFixture, fixtureSnapshot } from "./fixtures.js"

const findEntity = (
  entities: NonNullable<ReturnType<typeof materializeK8sCollection>["entities"]>,
  kind: string,
  id: string,
) => entities.find((entity) => entity.ref.kind === kind && entity.ref.id === id)

const relationshipKeys = (entity: { readonly relationships?: ReadonlyArray<{ readonly type: string; readonly target: { readonly kind: string; readonly id: string } }> }): ReadonlyArray<string> =>
  (entity.relationships ?? []).map(
    (relationship) => `${relationship.type}:${relationship.target.kind}:${relationship.target.id}`,
  )

describe("kubernetes plugin", () => {
  it("exports a manifest compatible with the plugin SDK", async () => {
    const decoded = await Effect.runPromise(decodePluginManifest(manifest))

    expect(decoded.id).toBe(K8S_PLUGIN_ID)
    expect(decoded.entityKinds.map((entity) => entity.id)).toEqual(
      expect.arrayContaining([
        K8S_ENTITY_KINDS.cluster,
        K8S_ENTITY_KINDS.namespace,
        K8S_ENTITY_KINDS.pod,
      ]),
    )
    expect(decoded.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining([K8S_ACTION_IDS.scaleWorkload, K8S_ACTION_IDS.restartPod]),
    )
  })

  it("detects kubectl-backed inventory support when a current context is configured", async () => {
    const agent = createK8sAgentPlugin({
      exec: createKubectlExecFixture(),
    })

    const detected = await Effect.runPromise(agent.detect({ nodeId: "node-1", now: 1 }))

    expect(detected).toEqual(
      expect.objectContaining({
        pluginId: K8S_PLUGIN_ID,
        status: "available",
      }),
    )
    expect(detected.features).toEqual(
      expect.arrayContaining(["inventory.pods", "inventory.deployments", "relationships.explicit"]),
    )
  })

  it("models cluster inventory and explicit workload relationships from realistic fixtures", () => {
    const collected = materializeK8sCollection("node-1", 1_712_000_000_000, fixtureSnapshot)
    const entities = collected.entities ?? []

    expect(entities).toHaveLength(12)

    const cluster = findEntity(entities, K8S_ENTITY_KINDS.cluster, "prod-cluster")
    const deployment = findEntity(entities, K8S_ENTITY_KINDS.deployment, "team-a/api")
    const service = findEntity(entities, K8S_ENTITY_KINDS.service, "team-a/api")
    const ingress = findEntity(entities, K8S_ENTITY_KINDS.ingress, "team-a/api")
    const job = findEntity(entities, K8S_ENTITY_KINDS.job, "team-a/data-migrate")
    const apiPod = findEntity(entities, K8S_ENTITY_KINDS.pod, "team-a/api-7d9bc6b5f6-abcde")

    expect(cluster).toBeDefined()
    expect(relationshipKeys(cluster!)).toEqual(
      expect.arrayContaining([
        "contains:k8s.namespace:team-a",
        "contains:k8s.namespace:kube-system",
        "contains:k8s.node:ip-10-0-1-10",
        "contains:k8s.node:ip-10-0-1-11",
      ]),
    )

    expect(relationshipKeys(deployment!)).toEqual(
      expect.arrayContaining([
        "contained-by:k8s.namespace:team-a",
        "manages:k8s.pod:team-a/api-7d9bc6b5f6-abcde",
        "manages:k8s.pod:team-a/api-7d9bc6b5f6-fghij",
      ]),
    )

    expect(relationshipKeys(service!)).toEqual(
      expect.arrayContaining([
        "contained-by:k8s.namespace:team-a",
        "selects:k8s.pod:team-a/api-7d9bc6b5f6-abcde",
        "selects:k8s.pod:team-a/api-7d9bc6b5f6-fghij",
        "exposed-by:k8s.ingress:team-a/api",
      ]),
    )

    expect(relationshipKeys(ingress!)).toEqual(
      expect.arrayContaining([
        "contained-by:k8s.namespace:team-a",
        "exposes:k8s.service:team-a/api",
      ]),
    )

    expect(relationshipKeys(job!)).toEqual(
      expect.arrayContaining([
        "contained-by:k8s.namespace:team-a",
        "manages:k8s.pod:team-a/data-migrate-8z2kh",
      ]),
    )

    expect(relationshipKeys(apiPod!)).toEqual(
      expect.arrayContaining([
        "contained-by:k8s.namespace:team-a",
        "managed-by:k8s.deployment:team-a/api",
        "runs-on:k8s.node:ip-10-0-1-10",
        "selected-by:k8s.service:team-a/api",
      ]),
    )
  })

  it("materializes plugin-native metrics and useful events from the snapshot", () => {
    const collected = materializeK8sCollection("node-1", 1_712_000_000_000, fixtureSnapshot)

    expect(collected.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "cluster.nodes.ready",
          value: 1,
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.cluster,
            id: "prod-cluster",
          }),
        }),
        expect.objectContaining({
          metricId: "namespace.workloads.ready",
          value: 2,
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.namespace,
            id: "team-a",
          }),
        }),
        expect.objectContaining({
          metricId: "workload.replicas.ready",
          value: 2,
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.deployment,
            id: "team-a/api",
          }),
        }),
        expect.objectContaining({
          metricId: "pod.restarts.total",
          value: 1,
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.pod,
            id: "team-a/api-7d9bc6b5f6-abcde",
          }),
        }),
      ]),
    )

    expect(collected.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "backoff",
          severity: "warning",
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.pod,
            id: "team-a/api-7d9bc6b5f6-abcde",
          }),
        }),
        expect.objectContaining({
          eventId: "nodenotready",
          severity: "warning",
          entity: expect.objectContaining({
            kind: K8S_ENTITY_KINDS.node,
            id: "ip-10-0-1-11",
          }),
        }),
      ]),
    )
  })

  it("collects kubernetes entities through the kubectl runtime path", async () => {
    const agent = createK8sAgentPlugin({
      exec: createKubectlExecFixture(),
    })

    const collected = await Effect.runPromise(
      agent.collect!({ nodeId: "node-1", now: 1_712_000_000_000 }),
    )

    expect(collected.entities).toHaveLength(12)
    expect(collected.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "cluster.nodes.ready", value: 1 }),
        expect.objectContaining({ metricId: "pod.restarts.total", value: 1 }),
      ]),
    )
    expect(collected.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: "backoff", severity: "warning" }),
      ]),
    )
    expect(
      collected.entities?.map((entity) => entity.ref.kind),
    ).toEqual(
      expect.arrayContaining([
        K8S_ENTITY_KINDS.cluster,
        K8S_ENTITY_KINDS.node,
        K8S_ENTITY_KINDS.pod,
        K8S_ENTITY_KINDS.deployment,
        K8S_ENTITY_KINDS.service,
        K8S_ENTITY_KINDS.ingress,
        K8S_ENTITY_KINDS.job,
      ]),
    )
  })

  it("executes describe, scale, and restart actions through the generic plugin action path", async () => {
    const plugin = {
      manifest,
      agent: createK8sAgentPlugin({
        exec: createKubectlExecFixture({
          "describe deployment api -n team-a": {
            stdout: "Name: api\nReplicas: 2 desired | 2 updated | 2 available\n",
            exitCode: 0,
          },
          "scale deployment api -n team-a --replicas 5": {
            stdout: "deployment.apps/api scaled\n",
            exitCode: 0,
          },
          "delete pod api-7d9bc6b5f6-abcde -n team-a": {
            stdout: 'pod "api-7d9bc6b5f6-abcde" deleted\n',
            exitCode: 0,
          },
        }),
      }),
    }

    await expect(
      Effect.runPromise(
        executePluginAction(
          plugin,
          { nodeId: "node-1", permissions: new Set(manifest.permissions) },
          {
            pluginId: K8S_PLUGIN_ID,
            actionId: K8S_ACTION_IDS.describeResource,
            target: {
              nodeId: "node-1",
              entity: {
                pluginId: K8S_PLUGIN_ID,
                kind: K8S_ENTITY_KINDS.deployment,
                nodeId: "node-1",
                id: "team-a/api",
              },
            },
            input: {},
          },
        ),
      ),
    ).resolves.toEqual({
      success: true,
      output: {
        text: "Name: api\nReplicas: 2 desired | 2 updated | 2 available\n",
      },
    })

    await expect(
      Effect.runPromise(
        executePluginAction(
          plugin,
          { nodeId: "node-1", permissions: new Set(manifest.permissions) },
          {
            pluginId: K8S_PLUGIN_ID,
            actionId: K8S_ACTION_IDS.scaleWorkload,
            target: {
              nodeId: "node-1",
              entity: {
                pluginId: K8S_PLUGIN_ID,
                kind: K8S_ENTITY_KINDS.deployment,
                nodeId: "node-1",
                id: "team-a/api",
              },
            },
            input: { replicas: 5 },
          },
        ),
      ),
    ).resolves.toEqual({
      success: true,
      output: {},
    })

    await expect(
      Effect.runPromise(
        executePluginAction(
          plugin,
          { nodeId: "node-1", permissions: new Set(manifest.permissions) },
          {
            pluginId: K8S_PLUGIN_ID,
            actionId: K8S_ACTION_IDS.restartPod,
            target: {
              nodeId: "node-1",
              entity: {
                pluginId: K8S_PLUGIN_ID,
                kind: K8S_ENTITY_KINDS.pod,
                nodeId: "node-1",
                id: "team-a/api-7d9bc6b5f6-abcde",
              },
            },
            input: {},
          },
        ),
      ),
    ).resolves.toEqual({
      success: true,
      output: {},
    })
  })

  it("opens pod log and session streams through the generic plugin stream path", async () => {
    const plugin = {
      manifest,
      agent: createK8sAgentPlugin({
        exec: createKubectlExecFixture({
          "logs api-7d9bc6b5f6-abcde -n team-a --tail 2 -c api": {
            stdout: "line one\nline two\n",
            exitCode: 0,
          },
          "exec -n team-a api-7d9bc6b5f6-abcde -c api -- sh -lc echo hi": {
            stdout: "hi\n",
            exitCode: 0,
          },
        }),
      }),
    }

    const logStream = await Effect.runPromise(
      openPluginStream(
        plugin,
        { nodeId: "node-1", permissions: new Set(manifest.permissions) },
        {
          pluginId: K8S_PLUGIN_ID,
          streamId: K8S_STREAM_IDS.podLogs,
          target: {
            nodeId: "node-1",
            entity: {
              pluginId: K8S_PLUGIN_ID,
              kind: K8S_ENTITY_KINDS.pod,
              nodeId: "node-1",
              id: "team-a/api-7d9bc6b5f6-abcde",
            },
          },
          input: { tail: 2, container: "api" },
        },
      ),
    )

    const logChunks = Array.from(await Effect.runPromise(Stream.runCollect(logStream)))
    expect(logChunks).toEqual([
      {
        lines: ["line one", "line two"],
        ts: expect.any(Number),
      },
    ])

  })

  it("exports schema-driven views for the web", () => {
    expect(web.views).toHaveLength(4)
    expect(web.views.map((view) => view.id)).toEqual(
      expect.arrayContaining(["k8s.cluster-overview", "k8s.pod-detail"]),
    )
  })
})
