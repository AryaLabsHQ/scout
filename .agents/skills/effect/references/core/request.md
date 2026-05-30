# Request / RequestResolver

`Request` and `RequestResolver` power Effect's request batching and caching model for data fetching.

## Define Request + Resolver

```typescript
import { Effect, Request, RequestResolver } from "effect"

type User = { readonly id: string; readonly name: string }

class GetUserById extends Request.Class("GetUserById")<User, string, {
  readonly id: string
}> {}

const resolver = RequestResolver.fromEffect((request: GetUserById) =>
  request.id === "0"
    ? Effect.fail("UserNotFound")
    : Effect.succeed({ id: request.id, name: "Ada" })
)

const program = Effect.request(new GetUserById({ id: "1" }), resolver)
```

Note: v4 provides both `Request.Class` (class-based) and `Request.TaggedClass` (string-tagged constructor pattern).

## Batched Resolver

```typescript
import { Request, RequestResolver } from "effect"

type User = { readonly id: string; readonly name: string }

class GetUserById extends Request.Class("GetUserById")<User, never, {
  readonly id: string
}> {}

const batched = RequestResolver.fromFunctionBatched<GetUserById>((requests) =>
  requests.map((request) => ({ id: request.id, name: `User-${request.id}` }))
)
```

## Key Functions

| Function | Description |
|----------|-------------|
| `Request.Class("Tag")<A, E, Fields>()` | Define a typed request model (class syntax) |
| `Request.TaggedClass<Tag>` | Tagged class constructor pattern |
| `RequestResolver.fromEffect(f)` | Resolve one request with an effect |
| `RequestResolver.fromFunctionBatched(f)` | Resolve batches in one call (infallible requests, `E = never`) |
| `Effect.request(request, resolver)` | Execute request through resolver |

## Use Cases

- Batched DB/API reads
- Per-request memoization
- Avoiding N+1 access patterns

---

**Source:** `effect/Request.ts` - see `~/Developer/effect/packages/effect/src/Request.ts`

**Source:** `effect/RequestResolver.ts` - see `~/Developer/effect/packages/effect/src/RequestResolver.ts`
