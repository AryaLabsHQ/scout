# Typeclass / HKT

Core provides higher-kinded types and dual-mode functions for custom abstractions.

## Core APIs

- **`HKT` namespace** — `HKT.TypeLambda`, `HKT.Kind`, `HKT.Variance` for encoding higher-kinded
  types.
- **`Function.dual`** — for building APIs that work both data-first and data-last (the building
  block typeclass instances rely on).

## Minimal HKT example

```ts
import { Function, HKT } from "effect";

interface Box<A> {
  readonly value: A;
}

interface BoxTypeLambda extends HKT.TypeLambda {
  readonly type: Box<this["Target"]>;
}

// data-last + data-first via Function.dual
const map: {
  <A, B>(f: (a: A) => B): (self: Box<A>) => Box<B>;
  <A, B>(self: Box<A>, f: (a: A) => B): Box<B>;
} = Function.dual(2, <A, B>(self: Box<A>, f: (a: A) => B): Box<B> => ({ value: f(self.value) }));
```

## Notes

- Most user code does **not** need to define typeclass instances directly. Prefer the concrete
  data-type modules (`Effect`, `Option`, `Result`, `Stream`, `Schedule`, `Cause`, `Exit`) — they
  already expose `map`/`flatMap`/etc. as standalone functions.
- For dual-mode APIs (data-first **and** data-last), use `Function.dual(arity, impl)` — that's how
  all built-in modules expose their functions.

---

**Source:** `effect/HKT.ts` - see `~/Developer/effect/packages/effect/src/HKT.ts` **Source:**
`effect/Function.ts` (`dual`) - see `~/Developer/effect/packages/effect/src/Function.ts`.
