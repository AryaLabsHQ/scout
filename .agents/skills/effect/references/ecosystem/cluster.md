# Cluster

## Table of Contents

- [Decision Tree](#decision-tree)
- [Entities](#entities)
- [Singleton](#singleton)
- [ClusterCron](#clustercron)
- [Runtime: assembling a cluster node](#runtime-assembling-a-cluster-node)
- [External clients (RPC-over-HTTP into the cluster)](#external-clients-rpc-over-http-into-the-cluster)
- [Storage backends](#storage-backends)
- [Kubernetes integration](#kubernetes-integration)
- [Testing](#testing)
- [Errors](#errors)
- [Annotations (per-RPC config)](#annotations-per-rpc-config)
- [Pitfalls](#pitfalls)
- [See Also](#see-also)

  > **API stability: `@stability unstable`.** Distributed entity / actor model with sharding and
  > durable message delivery. Module lives at `effect/cluster` — there is no separate
  > `@effect/cluster` package in v4.

**Source:** `effect/cluster/*` - see `~/Developer/effect/packages/effect/src/cluster/`

The cluster module spans 39 files; only the user-facing entry points are listed here. For internals
(envelope formats, runner lifecycle, snowflake IDs), read source directly.

| File                                                             | Purpose                                                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Entity.ts`                                                      | Define entity types from RPC procedures. `Entity.make`, `entity.toLayer`, `entity.client`                       |
| `Sharding.ts`                                                    | Distribute entities across runners. `Sharding.layer`                                                            |
| `Singleton.ts`                                                   | Cluster-wide singleton effects. `Singleton.make`                                                                |
| `ClusterCron.ts`                                                 | Distributed cron jobs that survive runner restarts                                                              |
| `ClusterError.ts`                                                | `EntityNotAssignedToRunner`, `MalformedMessage`, `PersistenceError`, `RunnerNotRegistered`, `RunnerUnavailable` |
| `Runner.ts`, `RunnerAddress.ts`, `RunnerHealth.ts`, `Runners.ts` | Runner registry + health                                                                                        |
| `RunnerStorage.ts`, `MessageStorage.ts`                          | Storage interfaces (provide concrete impl)                                                                      |
| `SqlMessageStorage.ts`, `SqlRunnerStorage.ts`                    | SQL-backed storage                                                                                              |
| `HttpRunner.ts`, `SocketRunner.ts`, `RunnerServer.ts`            | Transport layers                                                                                                |
| `EntityProxy.ts`, `EntityProxyServer.ts`                         | Expose entities over HTTP/RPC for external clients                                                              |
| `K8sHttpClient.ts`, `EntityResource.ts` (with `makeK8sPod`)      | Kubernetes integration                                                                                          |
| `TestRunner.ts`                                                  | In-memory cluster for tests                                                                                     |

## Decision Tree

```
What do I need?
├─ Define an entity (per-id state machine)         → Entity.make("Type", [rpc1, rpc2])
├─ Implement entity handlers                       → entity.toLayer({ Tag: handler }, { maxIdleTime, ... })
├─ Cluster-wide singleton                          → Singleton.make("name", effect)
├─ Distributed cron job                            → ClusterCron.make({ name, cron, execute })
├─ Runtime: Sharding + Runner + Storage            → Layer.mergeAll(Sharding.layer, RunnerHttp..., SqlMessageStorage.layer, ...)
├─ External client to call entities over HTTP/RPC  → EntityProxy.toRpcGroup / toHttpApiGroup
├─ Local tests                                     → TestRunner.layer
└─ Kubernetes pod-per-entity                       → EntityResource.makeK8sPod
```

## Entities

An **entity** is a per-id stateful actor identified by `(EntityType, EntityId)`. Messages are typed
RPCs; the cluster routes them to the correct runner based on shard assignment.

### Define

```ts
import { Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { Schema } from "effect";

const Increment = Rpc.make("Increment", {
  payload: { delta: Schema.Number },
  success: Schema.Number,
});
const Get = Rpc.make("Get", { success: Schema.Number });

const Counter = Entity.make("Counter", [Increment, Get]);
```

`Entity.make(type, rpcs)` is shorthand; `Entity.fromRpcGroup(type, group)` lets you reuse an
existing `RpcGroup`.

### Implement handlers

```ts
import { Effect, Ref } from "effect";

const CounterLive = Counter.toLayer(
  Effect.gen(function* () {
    const ref = yield* Ref.make(0);
    return {
      Increment: ({ delta }) => Ref.updateAndGet(ref, (n) => n + delta),
      Get: () => Ref.get(ref),
    };
  }),
  {
    maxIdleTime: "5 minutes", // unload entity from memory after idle
    concurrency: 1, // serialize per-entity messages
    mailboxCapacity: 64,
  },
);
```

The build effect runs **once per entity instance** (per id). Use `Ref` / `TxRef` / `Queue` /
`FiberMap` etc. to keep state across messages.

`CurrentAddress` and `CurrentRunnerAddress` services expose the entity's address and the runner
hosting it inside handlers — useful for logging.

### Call an entity from anywhere in the cluster

```ts
const program = Effect.gen(function* () {
  const sharding = yield* Sharding;
  const client = yield* Counter.client;
  // or: const client = yield* sharding.makeClient(Counter)

  const newValue = yield* client("user-123").Increment({ delta: 5 });
});
```

`client(entityId)` returns a typed RPC client — same shape as `RpcClient.make(group)` but with
cluster routing under the hood. Calls cross runners transparently.

## Singleton

A `Singleton` is an effect that runs **at most once across the entire cluster**. Useful for
leader-elected workers, schedulers, or "drain queue" daemons.

```ts
import { Singleton } from "effect/cluster";
import { Effect } from "effect";

const Scheduler = Singleton.make(
  "scheduler",
  Effect.forever(
    Effect.gen(function* () {
      yield* tickScheduler;
      yield* Effect.sleep("1 second");
    }),
  ),
  { shardGroup: "control-plane" }, // optional: pin to a shard group
);
```

Provide `Scheduler` as a layer alongside `Sharding.layer`. The cluster ensures only one runner runs
it at a time; if that runner dies, another takes over.

## ClusterCron

```ts
import { ClusterCron } from "effect/cluster";
import { Cron } from "effect";

const HourlyCleanup = ClusterCron.make({
  name: "hourly-cleanup",
  cron: Cron.parseUnsafe("0 * * * *"),
  execute: cleanupEffect,
});
```

Survives runner restarts and rebalances. Backed by `MessageStorage` (so requires a durable storage
layer).

## Runtime: assembling a cluster node

A runner needs:

1. **`ShardingConfig`** — runner identity, shard count, shard group
2. **`Sharding.layer`** — the sharding manager
3. **`Runners`** — the runner registry / RPC transport (`HttpRunner.layerHttp` for a node that
   serves runner routes, or a client-only transport layer for a process that only dials runners)
4. **`MessageStorage`** + **`RunnerStorage`** — durable state (`SqlMessageStorage.layer`,
   `SqlRunnerStorage.layer`)
5. **`RunnerHealth`** — health check
6. Your entity layers (`CounterLive`, etc.)

```ts
import { Config, Layer } from "effect";
import {
  Sharding,
  ShardingConfig,
  RunnerAddress,
  HttpRunner,
  RunnerHealth,
  SqlMessageStorage,
  SqlRunnerStorage,
} from "effect/cluster";
import { PgClient } from "@effect/sql-pg";
import { Option } from "effect";

const ClusterNode = Layer.mergeAll(
  Sharding.layer,
  HttpRunner.layerHttp,
  RunnerHealth.layerNoop,
  SqlMessageStorage.layer,
  SqlRunnerStorage.layer,
  CounterLive,
  Scheduler,
).pipe(
  Layer.provide(
    ShardingConfig.layer({
      runnerAddress: Option.some(RunnerAddress.make("10.0.1.5", 50000)),
      availableShardGroups: ["default"],
      assignedShardGroups: ["default"],
      shardsPerGroup: 256,
    }),
  ),
  Layer.provide(PgClient.layerConfig({ url: Config.Redacted("DATABASE_URL") })),
);
```

Run with `NodeRuntime.runMain(Layer.launch(ClusterNode))` — the runner registers itself, claims
shards, and starts processing messages.

## External clients (RPC-over-HTTP into the cluster)

`EntityProxy` exposes entities over standard `RpcGroup` / `HttpApiGroup` so external clients
(without `Sharding`) can call them.

```ts
import { EntityProxy, EntityProxyServer } from "effect/cluster";

const CounterProxy = EntityProxy.toHttpApiGroup("counters", Counter);
// Now CounterProxy is an HttpApiGroup; mount on your HttpApi.

const proxyHandlers = EntityProxyServer.layerHttpApi({
  group: CounterProxy,
  entity: Counter,
  // ... auth / address resolution
});
```

`EntityProxy.toRpcGroup(entity)` is the equivalent for RPC clients.

## Storage backends

| Backend   | Layer                                               | Notes                                          |
| --------- | --------------------------------------------------- | ---------------------------------------------- |
| In-memory | (built into `TestRunner.layer`)                     | Tests only                                     |
| SQL       | `SqlMessageStorage.layer`, `SqlRunnerStorage.layer` | Requires `SqlClient` (Postgres, MySQL, SQLite) |

For production, always use SQL-backed storage — entity state across restarts and rebalances depends
on it.

## Kubernetes integration

`EntityResource.makeK8sPod(...)` provisions a pod-per-entity. Pairs with `K8sHttpClient` and
`RunnerHealth` to run entities as discrete pods (e.g. one pod per active video session, large LLM
context, etc.).

```ts
import { EntityResource, K8sHttpClient } from "effect/cluster";

const PodsLive = K8sHttpClient.layer;
const Sessions = EntityResource.makeK8sPod({
  /* spec */
});
```

This is heavy machinery; read source before adopting.

## Testing

```ts
import { TestRunner } from "effect/cluster";
import { Layer } from "effect";

const TestCluster = Layer.mergeAll(TestRunner.layer, CounterLive);

it.effect("counter increments", () =>
  Effect.gen(function* () {
    const client = yield* Counter.client;
    const v = yield* client("c1").Increment({ delta: 5 });
    assert.strictEqual(v, 5);
  }).pipe(Effect.provide(TestCluster)),
);
```

`TestRunner.layer` provides a complete in-memory cluster (Sharding + Runners + Storage). Entity
handlers run synchronously within the test fiber.

## Errors

`ClusterError.ts` defines tagged errors for every transport / persistence failure mode:

- `EntityNotAssignedToRunner` — message arrived but no runner owns the shard. Usually transient
  during rebalance.
- `MalformedMessage` — schema decode failure on the wire.
- `PersistenceError` — storage backend failed. Likely needs operator intervention.
- `RunnerNotRegistered` — the recipient runner never registered. Indicates a config/discovery bug.
- `RunnerUnavailable` — runner is registered but not reachable right now. Retry is usually the
  answer.

Catch with `Effect.catchTags({ ... })` at the cluster boundary.

## Annotations (per-RPC config)

```ts
import { ClusterSchema } from "effect/cluster";

const PersistedRpc = MyRpc.annotate(ClusterSchema.Persisted, true);
// This RPC's invocations are durably stored before dispatch.

const TxRpc = MyRpc.annotate(ClusterSchema.WithTransaction, true);
// Invocation runs inside an Effect.tx boundary.

const NoInterrupt = MyRpc.annotate(ClusterSchema.Uninterruptible, "server");
// Server-side handler is uninterruptible.
```

Annotations are inspected by `Sharding` and the storage layer to decide how to route and persist.

## Pitfalls

- **All cluster nodes must agree on `shardsPerGroup` and shard-group assignments.** Changing shard
  layout requires a controlled migration, not an uncoordinated rolling deploy.
- **Storage backend mismatch** between runners makes the cluster split-brain. Pin both
  `MessageStorage` and `RunnerStorage` to the same backend across deployments.
- **Entity handlers must be idempotent** for `Persisted` RPCs. Deliver-once is best-effort; replays
  happen on runner crashes.
- **`maxIdleTime`** controls when an entity is evicted from memory. Setting it too low causes
  thrashing on hot entities; too high leaks memory. Start at `"5 minutes"`.
- **Mailbox capacity overflow** — entities serialize messages by default (`concurrency: 1`). If you
  need more parallelism per entity, raise `concurrency`; otherwise watch for mailbox backpressure
  (errors thrown on `client(...).Method(...)` when full).
- **Tracing is on by default.** For high-throughput entities, pass `disableTracing: true` to
  `entity.toLayer`.

## See Also

- [RPC](./rpc.md) — entities are essentially distributed `RpcGroup` handlers
- [SQL](./sql.md) — `SqlMessageStorage` / `SqlRunnerStorage` need a `SqlClient` layer
- [Workflow](./workflow.md) — durable workflow orchestration; `ClusterWorkflowEngine` integrates the
  two
