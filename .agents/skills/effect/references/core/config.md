# Config / ConfigProvider

## Table of Contents

- [Recommended Pattern: Config Service with Layer](#recommended-pattern-config-service-with-layer)
- [Config Recipes](#config-recipes)
- [Config Primitives](#config-primitives)
- [Validation with Schema (Recommended)](#validation-with-schema-recommended)
- [Defaults with `Config.withDefault()`](#defaults-with-configwithdefault)
- [Redacted for Secrets](#redacted-for-secrets)
- [ConfigProvider Patterns](#configprovider-patterns)
- [Layer Config Helpers (`layerConfig`)](#layer-config-helpers-layerconfig)
- [Testing Approach](#testing-approach)
- [Complete Example: Database Config Layer](#complete-example-database-config-layer)
- [Best Practices](#best-practices)
- [Key Functions](#key-functions)

Effect's `Config` module provides type-safe configuration loading

with validation, defaults, and transformations. `ConfigProvider` controls where values come from.

Read runtime configuration through `Config` recipes composed in layers — never reach for
`process.env` directly inside application logic. A `Config<T>` is yieldable and reads the current
`ConfigProvider` reference (default `ConfigProvider.fromEnv()`), so the same code decodes env vars
in production and deterministic values in tests.

## Recommended Pattern: Config Service with Layer

**Primary pattern:** Create a Config service using `Context.Service` with module-level `layer` and
`testLayer` exports. This separates config loading from business logic and makes testing
straightforward.

> **Naming note.** Some pattern references name an application-defined config service `Config` and
> call it as `Config.Service` / `Config.defaultLayer`. That is the project's own service module, not
> the root `effect/Config` module, which exports neither. Root `effect/Config` provides the
> `Config.String` / `Config.Redacted` / `Config.Int` recipes used inside the layer.

```typescript
import { Config, Effect, Layer, Redacted, Context } from "effect";

class ApiConfig extends Context.Service<
  ApiConfig,
  {
    readonly apiKey: Redacted.Redacted;
    readonly baseUrl: string;
    readonly timeout: number;
  }
>()("@app/ApiConfig") {}

const layer = Layer.effect(
  ApiConfig,
  Effect.gen(function* () {
    const apiKey = yield* Config.Redacted("API_KEY");
    const baseUrl = yield* Config.String("API_BASE_URL").pipe(
      Config.withDefault("https://api.example.com"),
    );
    const timeout = yield* Config.Int("API_TIMEOUT").pipe(Config.withDefault(30000));

    return { apiKey, baseUrl, timeout };
  }),
);

// For tests - hardcoded values, no ConfigProvider needed
const testLayer = Layer.succeed(ApiConfig, {
  apiKey: Redacted.make("test-key"),
  baseUrl: "https://test.example.com",
  timeout: 5000,
});

// Usage in production - reads from environment variables
const program = Effect.gen(function* () {
  const config = yield* ApiConfig;
  console.log(`API: ${config.baseUrl}`);
});

Effect.runPromise(program.pipe(Effect.provide(layer)));

// Usage in tests - direct values, no env vars needed
Effect.runPromise(program.pipe(Effect.provide(testLayer)));
```

**Why this pattern?**

- Separates config loading from business logic
- Easy to swap implementations (layer vs testLayer)
- Config errors caught early at layer composition
- Type-safe throughout your app
- Tests use `Layer.succeed()` with direct values—no ConfigProvider needed

## Config Recipes

Pick the recipe by the semantics you want, not by habit:

- `Config.Redacted(...)` — credentials and secrets (hidden in logs).
- `Config.schema(...)` — refined/validated values (preferred; automatic inference, rich errors,
  reusable schemas). `Config.mapEffect(...)` is the effectful alternative when a schema is overkill.
- `Config.option(...)` — semantic absence only: a missing key yields `Option.none()`; a present but
  invalid value or a source error still fails.
- `Config.flatMap(config, f)` — derive a second `Config` from a parsed value.
- `Config.withDefault(default)` — missing-data defaults **only**; malformed values still fail
  loudly.
- `Config.orElse(() => fallback)` — catches **any** parse failure, not just missing data. Reach for
  it only when you intentionally want to swallow validation errors (e.g. falling back to a second
  source), never as a plain default.
- `Config.unwrap(...)` / `Config.Wrap<T>` — build `layerConfig(...)` helpers (see below).

## Config Primitives

```typescript
import { Config, Schema } from "effect";

// Strings
Config.String("MY_VAR");

// Numbers
Config.Number("RATIO");
Config.Int("MAX_RETRIES");

// Booleans
Config.Boolean("DEBUG");

// Sensitive values (redacted in logs)
Config.Redacted("API_KEY");

// URLs
Config.URL("API_URL");

// Durations
Config.Duration("TIMEOUT");

// Arrays (comma-separated values in env vars)
Config.schema(Config.Array(Schema.String), "TAGS");

// Optional values
Config.option(Config.String("OPTIONAL_KEY"));
```

## Validation with Schema (Recommended)

Prefer `Config.schema()` for validation over the imperative `Config.mapEffect`. Schema provides
automatic type inference, rich validation errors, and reusable schemas; reach for `Config.mapEffect`
only for one-off refinements where defining a schema is overkill.

```typescript
import { Config, Effect, Schema } from "effect";

// Define schemas with built-in validation
const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
);

const Environment = Schema.Literals(["development", "staging", "production"]);

const program = Effect.gen(function* () {
  // Schema handles validation automatically
  const port = yield* Config.schema(Port, "PORT");
  const env = yield* Config.schema(Environment, "ENV");

  return { port, env };
});
```

**With branded types:**

```typescript
import { Config, Effect, Schema } from "effect";

const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port"),
);
type Port = typeof Port.Type;

const program = Effect.gen(function* () {
  const port = yield* Config.schema(Port, "PORT");
  // port is branded as Port, preventing misuse
  return port;
});
```

**Config.schema benefits:**

- Automatic type inference from schema
- Rich validation errors with schema messages
- Reusable schemas across config and runtime validation
- Full Schema transformation power (brands, transforms, refinements)

## Defaults with `Config.withDefault()`

Use `Config.withDefault(default)` for missing-data defaults. It fills in the value when the key is
absent **or an empty string** (`FOO=""` counts as missing; `Config.option` likewise yields
`Option.none()` — opt out with the provider's `preserveEmptyStrings` option when empty strings are
meaningful). A present-but-malformed value (e.g. `PORT=abc`) still fails loudly instead of being
silently masked. `Config.orElse(() => Config.succeed(default))` looks similar but catches **every**
config error including validation failures, so it is the wrong tool for a plain default — reserve it
for intentionally falling back to another source.

```typescript
import { Config, Effect } from "effect";

const program = Effect.gen(function* () {
  // Missing-data default: PORT absent → 3000; PORT=abc → fails
  const port = yield* Config.Int("PORT").pipe(Config.withDefault(3000));

  const baseUrl = yield* Config.String("API_BASE_URL").pipe(
    Config.withDefault("https://api.example.com"),
  );

  // Optional values
  const optionalKey = yield* Config.option(Config.String("OPTIONAL_KEY"));
  // Returns Option<string>

  return { port, baseUrl, optionalKey };
});
```

## Redacted for Secrets

Always use `Config.Redacted()` for sensitive values. Use `Redacted.value()` to extract the raw value
when needed.

```typescript
import { Config, Context, Effect, Layer, Redacted } from "effect";

class DatabaseConfig extends Context.Service<
  DatabaseConfig,
  {
    readonly host: string;
    readonly port: number;
    readonly password: Redacted.Redacted;
  }
>()("@app/DatabaseConfig") {}

const layer = Layer.effect(
  DatabaseConfig,
  Effect.gen(function* () {
    const host = yield* Config.String("DB_HOST");
    const port = yield* Config.Int("DB_PORT");
    const password = yield* Config.Redacted("DB_PASSWORD");

    return { host, port, password };
  }),
);

const program = Effect.gen(function* () {
  const config = yield* DatabaseConfig;

  // Use Redacted.value() to extract the raw value
  const password = Redacted.value(config.password);

  // Redacted values are hidden in logs
  console.log(config.password); // Output: <redacted>
  console.log(password); // Output: the-actual-password

  return { host: config.host, password };
});
```

**With Schema.Redacted():**

```typescript
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";

class ApiConfig extends Context.Service<
  ApiConfig,
  {
    readonly apiKey: Redacted.Redacted;
    readonly dbPassword: Redacted.Redacted;
  }
>()("@app/ApiConfig") {}

const layer = Layer.effect(
  ApiConfig,
  Effect.gen(function* () {
    const apiKey = yield* Config.schema(Schema.Redacted(Schema.String), "API_KEY");
    const dbPassword = yield* Config.schema(Schema.Redacted(Schema.String), "DB_PASSWORD");

    return { apiKey, dbPassword };
  }),
);
```

## ConfigProvider Patterns

- `ConfigProvider.layer(provider)` — **replace** the active provider for an app or suite.
- `ConfigProvider.layerAdd(provider)` — add a **fallback** consulted after the current provider;
  pass `{ asPrimary: true }` when the added provider must override the current one instead.
- `ConfigProvider.fromUnknown(root)` — deterministic config from a plain object/JSON (tests,
  embedded config, parsed files).
- `ConfigProvider.fromEnv()` — environment variables (the default provider).
- `ConfigProvider.constantCase` — map camelCase schema keys to `SCREAMING_SNAKE_CASE` env vars.
- `ConfigProvider.nested(prefix)` — scope a provider under a prefix.

Treat `.env`, directory, and environment providers (`fromEnv`, `fromDotEnv`, `fromDir`) as
startup/boundary sources, not business-workflow reads — decode config once at composition time.

```typescript
import { ConfigProvider, Effect } from "effect";

// From environment variables with prefix — reads APP_API_KEY, APP_PORT, etc.
const prefixedProvider = ConfigProvider.fromEnv().pipe(ConfigProvider.nested("APP"));
const prefixedLayer = ConfigProvider.layer(prefixedProvider);

// Deterministic config from a plain object (file-based config, tests)
const objectLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({ API_KEY: "prod-key", PORT: 8080 }),
);

// camelCase schema keys reading SCREAMING_SNAKE_CASE env vars
const constantCaseLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv().pipe(ConfigProvider.constantCase),
);

// Add an override on top of the ambient provider
const overrideLayer = ConfigProvider.layerAdd(
  ConfigProvider.fromUnknown({ FEATURE_FLAG: "true" }),
  { asPrimary: true },
);

Effect.runPromise(program.pipe(Effect.provide(prefixedLayer)));
```

**Nested Config Example:**

```typescript
import { Config, ConfigProvider, Effect, Layer } from "effect";

// With ConfigProvider.nested("APP"), environment variables like:
// APP_DB_HOST=localhost
// APP_DB_PORT=5432
// become accessible as DB_HOST, DB_PORT

const program = Effect.gen(function* () {
  const dbHost = yield* Config.String("DB_HOST");
  const dbPort = yield* Config.Int("DB_PORT");
  return { dbHost, dbPort };
});

const prefixedLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv().pipe(ConfigProvider.nested("APP")),
);

Effect.runPromise(program.pipe(Effect.provide(prefixedLayer)));
```

## Layer Config Helpers (`layerConfig`)

Library-style layers often expose both a concrete `layer(options)` and a config-backed
`layerConfig(config: Config.Wrap<Options>)`. `Config.Wrap<Options>` lets callers pass a struct where
each field is either a literal or a `Config`; `Config.unwrap` collapses it into a single
`Config<Options>` you decode inside the layer.

```typescript
import { Config, Effect, Layer } from "effect";

// Concrete form: caller already has decoded options
export const layer = (options: ClientOptions) =>
  Layer.effect(Client, makeClient(options).pipe(Effect.map((client) => Client.of(client))));

// Config-backed form: caller supplies a Config.Wrap the layer decodes at startup
export const layerConfig = (config: Config.Wrap<ClientOptions>) =>
  Layer.effect(
    Client,
    Config.unwrap(config).pipe(
      Effect.flatMap(makeClient),
      Effect.map((client) => Client.of(client)),
    ),
  );
```

Use `layerConfig` when a service naturally supports runtime config while still allowing tests and
embedding apps to pass concrete values.

**Test override guidance:**

- Use `Layer.succeed(AppConfig, testConfig)` when the app already wraps decoded config in a service
  and the test does not need to exercise Config decoding itself (the common case).
- Use `ConfigProvider.layer(ConfigProvider.fromUnknown(...))` when the test **does** exercise env
  decoding — e.g. verifying that a malformed value fails or that a default applies.

## Testing Approach

**Best practice:** Use `Layer.succeed()` with direct values. No need for `ConfigProvider` in tests
when using the service pattern.

```typescript
import { Effect, Layer, Redacted } from "effect";

// Test with inline values
Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.succeed(ApiConfig, {
        apiKey: Redacted.make("test-key"),
        baseUrl: "https://test.example.com",
        timeout: 5000,
      }),
    ),
  ),
);

// Different test with different values
Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.succeed(ApiConfig, {
        apiKey: Redacted.make("staging-key"),
        baseUrl: "https://staging.example.com",
        timeout: 10000,
      }),
    ),
  ),
);
```

**Why this works:**

- Your production code depends on `ApiConfig` service, not on `Config` primitives
- In tests, provide values directly with `Layer.succeed()`
- No need to mock environment variables or config providers
- Each test can use different values without predefined test layers

**Alternative: ConfigProvider for tests (if needed):**

```typescript
import { ConfigProvider, Effect, Layer } from "effect";

const testLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    API_KEY: "test-key",
    PORT: "3000",
  }),
);

Effect.runPromise(program.pipe(Effect.provide(testLayer)));
```

## Complete Example: Database Config Layer

```typescript
import { Config, Effect, Layer, Redacted, Schema, Context } from "effect";

const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
);

class DatabaseConfig extends Context.Service<
  DatabaseConfig,
  {
    readonly host: string;
    readonly port: number;
    readonly database: string;
    readonly password: Redacted.Redacted;
  }
>()("@app/DatabaseConfig") {}

const layer = Layer.effect(
  DatabaseConfig,
  Effect.gen(function* () {
    const host = yield* Config.schema(Schema.String, "DB_HOST");
    const port = yield* Config.schema(Port, "DB_PORT");
    const database = yield* Config.schema(Schema.String, "DB_NAME");
    const password = yield* Config.schema(Schema.Redacted(Schema.String), "DB_PASSWORD");

    return { host, port, database, password };
  }),
);

const testLayer = Layer.succeed(DatabaseConfig, {
  host: "localhost",
  port: 5432,
  database: "testdb",
  password: Redacted.make("test-password"),
});
```

## Best Practices

1. **Use the service pattern:** Create config services with `Context.Service` plus module-level
   `layer` and `testLayer` exports
2. **Validate with Schema:** Prefer `Config.schema()` over the imperative `Config.mapEffect`
3. **Use `withDefault` for defaults:** `Config.withDefault(default)` fills missing data only;
   reserve `Config.orElse(...)` for intentionally catching any parse failure
4. **Redact secrets:** Use `Config.Redacted()` or `Schema.Redacted()` for tokens, passwords, API
   keys
5. **Extract secrets:** Use `Redacted.value()` when you need the raw value
6. **Test with `Layer.succeed()`:** Provide direct values in tests—no ConfigProvider needed
7. **Prefix env vars:** Use `ConfigProvider.nested("APP")` for environment variable prefixes

## Key Functions

| Function                                   | Description                                      |
| ------------------------------------------ | ------------------------------------------------ |
| `Config.String(name)`                      | Read required string                             |
| `Config.Number(name)` / `Config.Int(name)` | Read number / integer                            |
| `Config.Boolean(name)`                     | Read boolean                                     |
| `Config.Redacted(name)`                    | Read sensitive value (hidden in logs)            |
| `Config.URL(name)`                         | Read URL                                         |
| `Config.Duration(name)`                    | Read duration string                             |
| `Config.ByteSize(name)`                    | Read exact byte-size string                      |
| `Config.schema(Config.Array(item), name)`  | Read comma-separated array                       |
| `Config.option(config)`                    | Make config optional                             |
| `Config.schema(Schema, name)`              | **Recommended:** Validate with Schema            |
| `Config.mapEffect(f)`                      | Effectful refinement (schema is preferred)       |
| `Config.withDefault(default)`              | **Preferred:** default on missing data only      |
| `Config.orElse(() => Config.succeed(v))`   | Fallback on **any** parse failure                |
| `Config.unwrap(wrap)` / `Config.Wrap<T>`   | Build `layerConfig(...)` helpers                 |
| `ConfigProvider.nested(prefix)`            | Prefix env var names                             |
| `ConfigProvider.constantCase`              | camelCase keys → SCREAMING_SNAKE_CASE            |
| `ConfigProvider.fromUnknown(obj)`          | Load from plain object / parsed JSON             |
| `ConfigProvider.fromEnvRecord(env)`        | Load from an explicit environment record         |
| `ConfigProvider.layer(provider)`           | Replace the active provider                      |
| `ConfigProvider.layerAdd(provider, opts)`  | Add fallback (`{ asPrimary: true }` to override) |
| `Redacted.value(redacted)`                 | Extract raw value from redacted                  |

**Source:** `effect/Config.ts` - see `~/Developer/effect/packages/effect/src/Config.ts` **Source:**
`effect/ConfigProvider.ts` - see `~/Developer/effect/packages/effect/src/ConfigProvider.ts`
