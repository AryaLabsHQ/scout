# Atom

**Source:** `effect/unstable/reactivity/Atom.ts` - see `~/Developer/effect/packages/effect/src/unstable/reactivity/Atom.ts`
**Source:** `effect/unstable/reactivity/AsyncResult.ts` - see `~/Developer/effect/packages/effect/src/unstable/reactivity/AsyncResult.ts`
**Source:** `effect/unstable/reactivity/AtomRef.ts` - see `~/Developer/effect/packages/effect/src/unstable/reactivity/AtomRef.ts`

`effect/unstable/reactivity` provides reactive state primitives integrated with Effect.

## Install

```bash
npm install effect
```

## Core Constructors

```ts
import * as Atom from "effect/unstable/reactivity/Atom"

const countAtom = Atom.make(0)
const nameAtom = Atom.make("Arya")
```

## Derived State

```ts
import * as Atom from "effect/unstable/reactivity/Atom"

const doubledAtom = Atom.map(countAtom, (n) => n * 2)
```

Use `Atom.transform(...)` for advanced state transforms.

## Runtime-Bound Async/Stream Atoms

> Rule: use `Effect.promise` only when the Promise cannot reject. If it can reject, use `Effect.tryPromise({ try, catch })`.
> Illustrative snippet: `/api/user` is a placeholder endpoint.

```ts
import * as Atom from "effect/unstable/reactivity/Atom"
import { Effect, Layer, Stream } from "effect"

const runtime = Atom.runtime(Layer.empty)

const userAtom = runtime.atom(
  Effect.tryPromise({
    try: () => fetch("/api/user").then((r) => r.json()),
    catch: (cause: unknown) => new Error(String(cause))
  })
)

const ticksAtom = runtime.atom(
  Stream.repeatEffect(Effect.sleep("1 second").pipe(Effect.as(new Date())))
)
```

To use a custom environment, create a runtime with a layer:

```ts
import { Layer } from "effect"

// Replace with the Layer that provides services required by your atom effects.
const myLayer = Layer.empty
const customRuntime = Atom.runtime(myLayer)
```

## Result Helpers

```ts
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"

const initial = AsyncResult.initial()
const waiting = AsyncResult.initial(true)
const ok = AsyncResult.success(123)
const failed = AsyncResult.failure(Cause.fail(new Error("boom")))

const failedWithPrevious = AsyncResult.failureWithPrevious(Cause.fail(new Error("boom")), {
  previous: Option.none(),
  waiting: true
})
```

## Framework Packages

- React: `@effect/atom-react`
- Solid: `@effect/atom-solid`
- Vue: `@effect/atom-vue`

These packages provide framework-specific bindings and re-export all modules from `effect/unstable/reactivity`.
