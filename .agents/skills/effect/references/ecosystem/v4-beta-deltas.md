---
name: v4-beta-deltas
description: Effect v4 beta changes after 4.0.0-beta.66 relevant to this skill. Reconcile against ~/Developer/effect CHANGELOG when upgrading pins.
---

# v4 beta deltas (skill pin: beta.74)

`MIGRATION.md` covers v3→v4 only. For **beta.66 → beta.74** (75 commits from prior skill pin), use this page plus `packages/effect/CHANGELOG.md`.

## Schema

| Change | Since | Skill impact |
|--------|-------|--------------|
| `Schema.asserts(schema, input)` — direct assert; removed `Schema.Codec.ToAsserts` | beta.68 | See [schema.md](../schema/schema.md) |
| `SchemaParser.makeUnsafe` → `SchemaParser.make` | beta.67 | Use `make` in new code |
| Decoding/constructor defaults can fail with `SchemaError` and require `R` | beta.67 | Defaults may `yield*` services |
| `Schema.Array` / `NonEmptyArray` `.value` restored | beta.71 | Collection wrapper API parity |
| JSON Schema custom annotation passthrough | beta.71 | OpenAPI / codegen |

## Effect / errors

| Change | Since | Skill impact |
|--------|-------|--------------|
| `catch*` combinators preserve unhandled error types in inference | beta.71 | Typed error channels stay accurate |
| `Effect.Yieldable` removed | beta.66 | Use `Cause.YieldableError` / `Schema.TaggedErrorClass` — not `Effect.Yieldable` |

## Runtime / platform

| Change | Since | Skill impact |
|--------|-------|--------------|
| `Crypto` service — `randomUUIDv4` / `randomUUIDv7`, secure bytes | beta.68 | Prefer over `Random.nextUUIDv4` (removed) |
| `Model.Generated` → `Model.GeneratedByDb` | beta.68 | SQL/model docs |

## HttpApi

| Change | Since | Skill impact |
|--------|-------|--------------|
| `HttpApiSecurity.http({ scheme })` custom Authorization schemes | beta.73 | See [httpapi.md](httpapi.md) |
| `HttpApiTest.groups` optional `baseUrl` | beta.66 | E2E tests |
| OpenAPI custom security scheme generation | beta.73 | Spec export |
| `layerSchemaErrorTransform` | (pre-beta.66 in range) | Map `HttpApiSchemaError` to declared middleware errors |

## CLI / workflow / other

| Change | Since | Skill impact |
|--------|-------|--------------|
| `Command.withHidden`, `Flag.withHidden` | beta.69–70 | Hidden subcommands/flags |
| `Schedule.tap` — observe schedule metadata | beta.71 | [schedule.md](../retry/schedule.md) |
| `Stream.broadcastN` | beta.68 | Fan-out streams |
| `@effect/vitest` forked memo maps for nested `it.layer` | beta.67 | Test isolation |

When pinning a new beta, run `skill-sync` on `effect` and update `metadata/skill-sources.md`.
