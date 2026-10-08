# Exit

`Exit<A, E>` captures the full result of an Effect: success value or failure cause.

## Create Exit

```ts
import { Effect, Exit } from "effect";

const successExit = Exit.succeed(42);
const failureExit = Exit.fail("boom");
const defectExit = Exit.die(new Error("unexpected"));
const interruptExit = Exit.interrupt();
```

**Source:** `effect/Exit.ts` - see `~/Developer/effect/packages/effect/src/Exit.ts`

## Inspect Exit

```ts
import { Exit } from "effect";

const isOk = Exit.isSuccess(successExit);
const isErr = Exit.isFailure(failureExit);
const hasTypedErrors = Exit.hasFails(failureExit);
const hasDefects = Exit.hasDies(defectExit);
const hasInterrupts = Exit.hasInterrupts(interruptExit);
```

**Source:** `effect/Exit.ts` - see `~/Developer/effect/packages/effect/src/Exit.ts`

## Pattern Match

```ts
import { Cause, Exit } from "effect";

const message = Exit.match(failureExit, {
  onSuccess: (value) => `ok:${value}`,
  onFailure: (cause) => `failed:${Cause.pretty(cause)}`,
});
```

**Source:** `effect/Exit.ts` - see `~/Developer/effect/packages/effect/src/Exit.ts`

## Extract Values

```ts
import { Exit, Option } from "effect";

const valueOpt = Exit.getSuccess(successExit);
// Option.some(42)

const causeOpt = Exit.getCause(failureExit);
// Option.some(Cause with "boom")

const errorOpt = Exit.findErrorOption(failureExit);
// Option.some("boom") — extracts first typed error
```

**Source:** `effect/Exit.ts` - see `~/Developer/effect/packages/effect/src/Exit.ts`

## Convert Exit

```ts
import { Cause, Exit } from "effect";

const either = Exit.match(successExit, {
  onSuccess: (v) => ({ _tag: "Right" as const, right: v }),
  onFailure: (cause) => ({ _tag: "Left" as const, left: Cause.pretty(cause) }),
});

const option = Exit.getSuccess(successExit);
```

## Usage Notes

- `Exit<A, E>` is a union of `Success<A, E>` and `Failure<A, E>`
- A `Failure` wraps a `Cause<E>`, which may contain typed errors (`Fail`), defects (`Die`), or
  interruptions (`Interrupt`)
- `Cause.pretty` renders a cause as a human-readable string
- Filter APIs (`Exit.filterSuccess`, `Exit.filterValue`, `Exit.findError`, etc.) return `Result`
  values for pipeline composition
- `Exit.map`, `Exit.mapError`, `Exit.mapBoth` transform the success or error channels
- `Exit.asVoid` discards the value, replacing with `void`
- `Exit.asVoidAll` combines multiple exits into one void exit

## Common APIs

**Constructors**: `Exit.succeed`, `Exit.fail`, `Exit.failCause`, `Exit.die`, `Exit.interrupt`,
`Exit.void` **Guards**: `Exit.isExit`, `Exit.isSuccess`, `Exit.isFailure`, `Exit.hasFails`,
`Exit.hasDies`, `Exit.hasInterrupts` **Access**: `Exit.getSuccess`, `Exit.getCause`,
`Exit.findErrorOption` **Transform**: `Exit.map`, `Exit.mapError`, `Exit.mapBoth`, `Exit.asVoid`,
`Exit.asVoidAll` **Match**: `Exit.match({ onSuccess, onFailure })` **Filters**:
`Exit.filterSuccess`, `Exit.filterValue`, `Exit.filterFailure`, `Exit.filterCause`,
`Exit.findError`, `Exit.findDefect`
