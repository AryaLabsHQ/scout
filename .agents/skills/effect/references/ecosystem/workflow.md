# Workflow

> **Unstable in v4.** Durable workflow orchestration — like Temporal/Inngest but native to Effect. Module lives at `effect/unstable/workflow` — no separate `@effect/workflow` package in v4.

**Source:** `effect/unstable/workflow/*` - see `~/Developer/effect/packages/effect/src/unstable/workflow/`

| File | Purpose |
|---|---|
| `Workflow.ts` | Define a workflow (`Workflow.make`), implement (`workflow.toLayer`), invoke (`workflow.execute`) |
| `Activity.ts` | Define an idempotent unit of work executed inside a workflow (`Activity.make`) |
| `WorkflowEngine.ts` | Runtime that drives workflow execution + persistence. `WorkflowEngine.layerMemory` for tests; `ClusterWorkflowEngine` (in cluster module) for prod |
| `DurableClock.ts` | Persistent sleep that survives runner restarts |
| `DurableDeferred.ts` | Persistent `Deferred` that other workflows can complete |
| `WorkflowProxy.ts`, `WorkflowProxyServer.ts` | Expose workflows over HTTP/RPC for external invocation |

## Mental model

A **workflow** is a long-running, possibly-suspending effect identified by a deterministic execution id (derived from the payload via `idempotencyKey`). The `WorkflowEngine` persists progress: each `Activity` checkpoint is recorded, so on crash/restart the workflow resumes from the last completed step.

You write workflow code as an ordinary `Effect.gen` — but every side effect must go through an `Activity` so the engine can record its result. Re-running a workflow replays the deterministic logic and skips activities whose results are already persisted.

## Decision Tree

```
What do I need?
├─ Define a workflow                              → Workflow.make({ name, payload, idempotencyKey, success, error })
├─ Implement workflow body                        → workflow.toLayer((payload, executionId) => Effect.gen(...))
├─ A side effect inside a workflow                → Activity.make({ name, success, error, execute })
├─ Sleep that survives restart                    → DurableClock.sleep("5 minutes")
├─ Wait for an external signal                    → DurableDeferred.make + DurableDeferred.into / await
├─ Compensation on failure                        → workflow.withCompensation((value, cause) => cleanup)
├─ Add cleanup finalizer                          → Workflow.addFinalizer
├─ Invoke from outside                            → workflow.execute(payload) (Effect)
├─ Poll for result                                → workflow.poll(executionId)
├─ Interrupt running execution                    → workflow.interrupt(executionId)
├─ Engine for tests                               → WorkflowEngine.layerMemory
├─ Engine for production                          → ClusterWorkflowEngine.layer (from cluster module)
└─ External clients (RPC/HTTP)                    → WorkflowProxy.toRpcGroup / toHttpApiGroup
```

## Define a workflow

```ts
import { Workflow } from "effect/unstable/workflow"
import { Schema } from "effect"

const ProcessOrder = Workflow.make({
  name: "ProcessOrder",
  payload: { orderId: Schema.String, total: Schema.Number },
  idempotencyKey: ({ orderId }) => orderId,         // same orderId → same executionId
  success: Schema.Struct({ chargeId: Schema.String }),
  error: Schema.String,
})
```

`idempotencyKey` is **mandatory**. Two `execute()` calls with the same key share an execution — the second observes the first's result instead of starting a new run. This is what makes "exactly-once" possible.

## Implement workflow body

```ts
import { Activity, Workflow } from "effect/unstable/workflow"
import { Effect } from "effect"

const ProcessOrderLive = ProcessOrder.toLayer((payload, executionId) =>
  Effect.gen(function*() {
    yield* Effect.logInfo(`processing ${payload.orderId}`)

    // Each Activity is a checkpoint. Result is persisted; on replay it's skipped.
    const charge = yield* Activity.make({
      name: "charge-card",
      success: Schema.Struct({ chargeId: Schema.String }),
      error: Schema.String,
      execute: chargeCard(payload.orderId, payload.total),
    })

    yield* Activity.make({
      name: "send-receipt",
      execute: sendReceipt(payload.orderId, charge.chargeId),
    })

    return { chargeId: charge.chargeId }
  }),
)
```

**Activity rules:**
- **Idempotent.** Activities are retried on transient failures; running twice must be safe (or guarded by an external dedup key).
- **No nested activities.** Activities can't contain other activities.
- **Schema-typed result.** Successful results are persisted via `success`/`error` schemas. Use `Schema.Void` if there's no return value.

## Invoke a workflow

```ts
const program = Effect.gen(function*() {
  const result = yield* ProcessOrder.execute({ orderId: "ord-42", total: 19.99 })
  // result: { chargeId: string }   (or fails with the typed error)
})
```

Add `{ discard: true }` to fire-and-forget — returns just the `executionId` string instead of waiting for the result:

```ts
const id = yield* ProcessOrder.execute({ orderId: "ord-42", total: 19.99 }, { discard: true })

// later, from anywhere:
const result = yield* ProcessOrder.poll(id)   // Option<Result<Success, Error>>
```

`workflow.interrupt(executionId)` cancels a running execution. `workflow.resume(executionId)` continues a suspended one (after `Workflow.suspend`).

## Durable sleep + signals

```ts
import { DurableClock, DurableDeferred } from "effect/unstable/workflow"

const SchedulingWorkflow = ScheduleEmail.toLayer((payload) =>
  Effect.gen(function*() {
    yield* sendEmail(payload.firstEmail)

    // Survives runner restarts. The engine wakes the workflow at the right time.
    yield* DurableClock.sleep("3 days")

    yield* sendEmail(payload.followUp)
  }),
)
```

`DurableDeferred` is a workflow-aware `Deferred` — useful for waiting on external events:

```ts
const ApprovalWorkflow = WaitForApproval.toLayer((payload, executionId) =>
  Effect.gen(function*() {
    const approval = yield* DurableDeferred.make<boolean>("approval")
    // External system completes via DurableDeferred.into:
    //   yield* DurableDeferred.into(approval, true)
    const approved = yield* approval.await
    if (!approved) return yield* Effect.fail("rejected")
    yield* doApprovedThing()
  }),
)
```

## Compensation (saga pattern)

If a workflow fails after partial progress, registered compensations run in reverse order:

```ts
const Workflow = ProcessOrder.toLayer((payload) =>
  Effect.gen(function*() {
    const charge = yield* Activity.make({
      name: "charge",
      execute: chargeCard(payload.total),
    })

    yield* shipOrder(payload.orderId).pipe(
      ProcessOrder.withCompensation((_, cause) =>
        // Runs only if the workflow ultimately fails
        Effect.gen(function*() {
          yield* refundCard(charge.chargeId)
        }),
      ),
    )
  }),
)
```

> **Caveat from source:** compensation only registers for **top-level effects in the workflow**. Compensations for effects nested inside an activity won't fire — wrap each compensable step at the workflow level.

## Engine

The engine drives execution + persistence. Choose by environment:

```ts
import { WorkflowEngine } from "effect/unstable/workflow"

// Tests: in-memory, no persistence
const TestEngine = WorkflowEngine.layerMemory

// Production: cluster-backed (from the cluster module)
import { ClusterWorkflowEngine } from "effect/unstable/cluster"
const ProdEngine = ClusterWorkflowEngine.layer
```

Provide the engine + your workflow layers:

```ts
const App = Layer.mergeAll(
  ProcessOrderLive,
  ApprovalLive,
  // ... other workflow layers
).pipe(Layer.provide(ProdEngine))
```

## External invocation (RPC / HTTP)

Expose workflows as RPC procedures or HTTP endpoints so external services can trigger them:

```ts
import { WorkflowProxy } from "effect/unstable/workflow"

const WorkflowsRpc = WorkflowProxy.toRpcGroup([ProcessOrder, ApprovalWorkflow])
// Now WorkflowsRpc is an RpcGroup; mount with RpcServer.

const WorkflowsApi = WorkflowProxy.toHttpApiGroup("workflows", [ProcessOrder, ApprovalWorkflow])
// Mount as part of an HttpApi.
```

`WorkflowProxyServer.layerHttpApi(...)` / `layerRpcHandlers(...)` wires the proxy handlers — they translate incoming requests into `workflow.execute(...)` calls.

## Pitfalls

- **Workflow body must be deterministic.** Don't use `Date.now()`, `Math.random()`, or read external state outside an activity. Replay re-runs the body; non-determinism causes divergence and engine errors.
- **Activities must be idempotent.** An activity may execute more than once on retries. Use deterministic IDs / external dedup if it touches external systems (charge-card, send-email, etc.).
- **No nested activities.** `Activity.make` inside another `Activity.make` is not supported. Sequence them at the workflow level.
- **Compensation scope.** Compensation only attaches to top-level workflow effects. Don't expect it to roll back something declared inside an activity body.
- **`idempotencyKey` collisions** — two payloads producing the same key collapse into one execution. If that's not what you want, include enough payload fields in the key.
- **`DurableClock.sleep` ≠ `Effect.sleep`.** Plain `Effect.sleep` doesn't persist — on restart the timer is lost. Always use `DurableClock` inside workflows.
- **Activity success/error schemas drive persistence.** If you change them after deploy, in-flight executions may fail to deserialize. Treat them as wire-format: version with care.

## See Also

- [Cluster](./cluster.md) — `ClusterWorkflowEngine` is the production backend
- [Schema](../schema/schema.md) — payload / success / error schemas
- [Schedule](../retry/schedule.md) — `suspendedRetrySchedule` for retry-on-suspension
