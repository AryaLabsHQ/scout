# Config / ConfigProvider

Effect's `Config` module provides type-safe configuration loading with validation, defaults, and transformations. `ConfigProvider` controls where values come from.

## Recommended Pattern: Config Service with Layer

**Primary pattern:** Create a Config service using `Context.Service` with static `layer` and `testLayer` exports. This separates config loading from business logic and makes testing straightforward.

```typescript
import { Config, Effect, Layer, Redacted, Context } from "effect"

class ApiConfig extends Context.Service<
  ApiConfig,
  {
    readonly apiKey: Redacted.Redacted
    readonly baseUrl: string
    readonly timeout: number
  }
>()("@app/ApiConfig") {
  static readonly layer = Layer.effect(
    ApiConfig,
    Effect.gen(function* () {
      const apiKey = yield* Config.redacted("API_KEY")
      const baseUrl = yield* Config.string("API_BASE_URL").pipe(
        Config.orElse(() => Config.succeed("https://api.example.com"))
      )
      const timeout = yield* Config.int("API_TIMEOUT").pipe(
        Config.orElse(() => Config.succeed(30000))
      )

      return { apiKey, baseUrl, timeout }
    })
  )

  // For tests - hardcoded values, no ConfigProvider needed
  static readonly testLayer = Layer.succeed(
    ApiConfig,
    {
      apiKey: Redacted.make("test-key"),
      baseUrl: "https://test.example.com",
      timeout: 5000,
    }
  )
}

// Usage in production - reads from environment variables
const program = Effect.gen(function* () {
  const config = yield* ApiConfig
  console.log(`API: ${config.baseUrl}`)
})

Effect.runPromise(program.pipe(Effect.provide(ApiConfig.layer)))

// Usage in tests - direct values, no env vars needed
Effect.runPromise(program.pipe(Effect.provide(ApiConfig.testLayer)))
```

**Why this pattern?**
- Separates config loading from business logic
- Easy to swap implementations (layer vs testLayer)
- Config errors caught early at layer composition
- Type-safe throughout your app
- Tests use `Layer.succeed()` with direct values—no ConfigProvider needed

## Config Primitives

```typescript
import { Config } from "effect"

// Strings
Config.string("MY_VAR")

// Numbers
Config.number("RATIO")
Config.int("MAX_RETRIES")

// Booleans
Config.boolean("DEBUG")

// Sensitive values (redacted in logs)
Config.redacted("API_KEY")

// URLs
Config.url("API_URL")

// Durations
Config.duration("TIMEOUT")

// Arrays (comma-separated values in env vars)
Config.array(Config.string(), "TAGS")

// Optional values
Config.option(Config.string("OPTIONAL_KEY"))
```

## Validation with Schema (Recommended)

Use `Config.schema()` for validation—NOT `Config.mapOrFail`. This provides automatic type inference, rich validation errors, and reusable schemas.

```typescript
import { Config, Effect, Schema } from "effect"

// Define schemas with built-in validation
const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))
)

const Environment = Schema.Literals(["development", "staging", "production"])

const program = Effect.gen(function* () {
  // Schema handles validation automatically
  const port = yield* Config.schema(Port, "PORT")
  const env = yield* Config.schema(Environment, "ENV")

  return { port, env }
})
```

**With branded types:**

```typescript
import { Config, Effect, Schema } from "effect"

const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  Schema.brand("Port")
)
type Port = typeof Port.Type

const program = Effect.gen(function* () {
  const port = yield* Config.schema(Port, "PORT")
  // port is branded as Port, preventing misuse
  return port
})
```

**Config.schema benefits:**
- Automatic type inference from schema
- Rich validation errors with schema messages
- Reusable schemas across config and runtime validation
- Full Schema transformation power (brands, transforms, refinements)

## Defaults with `Config.orElse()` (Preferred)

Use `Config.orElse(() => Config.succeed(default))` for fallbacks. Avoid `Config.withDefault()`—the `orElse` pattern is more explicit and composes better.

```typescript
import { Config, Effect } from "effect"

const program = Effect.gen(function* () {
  // Preferred: orElse with Config.succeed
  const port = yield* Config.int("PORT").pipe(
    Config.orElse(() => Config.succeed(3000))
  )

  const baseUrl = yield* Config.string("API_BASE_URL").pipe(
    Config.orElse(() => Config.succeed("https://api.example.com"))
  )

  // Optional values
  const optionalKey = yield* Config.option(Config.string("OPTIONAL_KEY"))
  // Returns Option<string>

  return { port, baseUrl, optionalKey }
})
```

## Redacted for Secrets

Always use `Config.redacted()` for sensitive values. Use `Redacted.value()` to extract the raw value when needed.

```typescript
import { Config, Effect, Redacted, Context } from "effect"

class DatabaseConfig extends Context.Service<
  DatabaseConfig,
  {
    readonly host: string
    readonly port: number
    readonly password: Redacted.Redacted
  }
>()("@app/DatabaseConfig") {
  static readonly layer = Layer.effect(
    DatabaseConfig,
    Effect.gen(function* () {
      const host = yield* Config.string("DB_HOST")
      const port = yield* Config.int("DB_PORT")
      const password = yield* Config.redacted("DB_PASSWORD")

      return { host, port, password }
    })
  )
}

const program = Effect.gen(function* () {
  const config = yield* DatabaseConfig

  // Use Redacted.value() to extract the raw value
  const password = Redacted.value(config.password)

  // Redacted values are hidden in logs
  console.log(config.password) // Output: <redacted>
  console.log(password)        // Output: the-actual-password

  return { host: config.host, password }
})
```

**With Schema.Redacted():**

```typescript
import { Config, Effect, Schema, Context } from "effect"

class ApiConfig extends Context.Service<
  ApiConfig,
  {
    readonly apiKey: Redacted.Redacted
    readonly dbPassword: Redacted.Redacted
  }
>()("@app/ApiConfig") {
  static readonly layer = Layer.effect(
    ApiConfig,
    Effect.gen(function* () {
      const apiKey = yield* Config.schema(Schema.Redacted(Schema.String), "API_KEY")
      const dbPassword = yield* Config.schema(Schema.Redacted(Schema.String), "DB_PASSWORD")

      return { apiKey, dbPassword }
    })
  )
}
```

## ConfigProvider Patterns

Override where config is loaded from using `ConfigProvider.layer`:

```typescript
import { ConfigProvider, Effect, Layer } from "effect"

// From environment variables with prefix
const prefixedProvider = ConfigProvider.fromEnv().pipe(
  ConfigProvider.nested("APP") // Reads APP_API_KEY, APP_PORT, etc.
)

const prefixedLayer = ConfigProvider.layer(prefixedProvider)

// From JSON (useful for file-based config)
const jsonProvider = ConfigProvider.fromJson({
  API_KEY: "prod-key",
  PORT: 8080,
})

const jsonLayer = ConfigProvider.layer(jsonProvider)

// From Map (useful for testing with ConfigProvider approach)
const mapProvider = ConfigProvider.fromMap(
  new Map([
    ["API_KEY", "test-key-123"],
    ["PORT", "3000"],
  ])
)

const mapLayer = ConfigProvider.layer(mapProvider)

// Usage
Effect.runPromise(program.pipe(Effect.provide(prefixedLayer)))
```

**Nested Config Example:**

```typescript
import { Config, ConfigProvider, Effect, Layer } from "effect"

// With ConfigProvider.nested("APP"), environment variables like:
// APP_DB_HOST=localhost
// APP_DB_PORT=5432
// become accessible as DB_HOST, DB_PORT

const program = Effect.gen(function* () {
  const dbHost = yield* Config.string("DB_HOST")
  const dbPort = yield* Config.int("DB_PORT")
  return { dbHost, dbPort }
})

const prefixedLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv().pipe(ConfigProvider.nested("APP"))
)

Effect.runPromise(program.pipe(Effect.provide(prefixedLayer)))
```

## Testing Approach

**Best practice:** Use `Layer.succeed()` with direct values. No need for `ConfigProvider` in tests when using the service pattern.

```typescript
import { Effect, Layer, Redacted } from "effect"

// Test with inline values
Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.succeed(ApiConfig, {
        apiKey: Redacted.make("test-key"),
        baseUrl: "https://test.example.com",
        timeout: 5000,
      })
    )
  )
)

// Different test with different values
Effect.runPromise(
  program.pipe(
    Effect.provide(
      Layer.succeed(ApiConfig, {
        apiKey: Redacted.make("staging-key"),
        baseUrl: "https://staging.example.com",
        timeout: 10000,
      })
    )
  )
)
```

**Why this works:**
- Your production code depends on `ApiConfig` service, not on `Config` primitives
- In tests, provide values directly with `Layer.succeed()`
- No need to mock environment variables or config providers
- Each test can use different values without predefined test layers

**Alternative: ConfigProvider for tests (if needed):**

```typescript
import { ConfigProvider, Effect, Layer } from "effect"

const testLayer = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    API_KEY: "test-key",
    PORT: "3000",
  })
)

Effect.runPromise(program.pipe(Effect.provide(testLayer)))
```

## Complete Example: Database Config Layer

```typescript
import { Config, Effect, Layer, Redacted, Schema, Context } from "effect"

const Port = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))
)

class DatabaseConfig extends Context.Service<
  DatabaseConfig,
  {
    readonly host: string
    readonly port: number
    readonly database: string
    readonly password: Redacted.Redacted
  }
>()("@app/DatabaseConfig") {
  static readonly layer = Layer.effect(
    DatabaseConfig,
    Effect.gen(function* () {
      const host = yield* Config.schema(Schema.String, "DB_HOST")
      const port = yield* Config.schema(Port, "DB_PORT")
      const database = yield* Config.schema(Schema.String, "DB_NAME")
      const password = yield* Config.schema(Schema.Redacted(Schema.String), "DB_PASSWORD")

      return { host, port, database, password }
    })
  )

  static readonly testLayer = Layer.succeed(
    DatabaseConfig,
    {
      host: "localhost",
      port: 5432,
      database: "testdb",
      password: Redacted.make("test-password"),
    }
  )
}
```

## Best Practices

1. **Use the service pattern:** Create config services with `Context.Service`, static `layer`, and `testLayer`
2. **Validate with Schema:** Use `Config.schema()` for validation, NOT `Config.mapOrFail`
3. **Use `orElse` for defaults:** `Config.orElse(() => Config.succeed(default))` is preferred over `withDefault`
4. **Redact secrets:** Use `Config.redacted()` or `Schema.Redacted()` for tokens, passwords, API keys
5. **Extract secrets:** Use `Redacted.value()` when you need the raw value
6. **Test with `Layer.succeed()`:** Provide direct values in tests—no ConfigProvider needed
7. **Prefix env vars:** Use `ConfigProvider.nested("APP")` for environment variable prefixes

## Key Functions

| Function | Description |
|----------|-------------|
| `Config.string(name)` | Read required string |
| `Config.number(name)` / `Config.int(name)` | Read number / integer |
| `Config.boolean(name)` | Read boolean |
| `Config.redacted(name)` | Read sensitive value (hidden in logs) |
| `Config.url(name)` | Read URL |
| `Config.duration(name)` | Read duration string |
| `Config.array(item, name)` | Read comma-separated array |
| `Config.option(config)` | Make config optional |
| `Config.schema(Schema, name)` | **Recommended:** Validate with Schema |
| `Config.orElse(() => Config.succeed(v))` | **Preferred:** Provide fallback |
| `ConfigProvider.nested(prefix)` | Prefix env var names |
| `ConfigProvider.fromJson(obj)` | Load from JSON object |
| `ConfigProvider.fromMap(map)` | Load from Map |
| `Redacted.value(redacted)` | Extract raw value from redacted |

**Source:** `effect/Config.ts` - see `~/Developer/effect/packages/effect/src/Config.ts`
**Source:** `effect/ConfigProvider.ts` - see `~/Developer/effect/packages/effect/src/ConfigProvider.ts`
