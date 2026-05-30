# CLI

> **Unstable in v4.** Build typed CLIs from Effect programs. The module lives at `effect/unstable/cli` — there is no separate `@effect/cli` package in v4.

**Source:** `effect/unstable/cli/*` - see `~/Developer/effect/packages/effect/src/unstable/cli/`
- `Command.ts` — command definition, composition, `run` / `runWith`
- `Flag.ts` — long-form flags (`--name`)
- `Argument.ts` — positional arguments
- `Param.ts` — shared primitive of flags + arguments
- `Primitive.ts` — typed coercion (string, integer, boolean, date, etc.)
- `Prompt.ts` — interactive prompts (text, select, confirm, multiSelect, password, etc.)
- `GlobalFlag.ts` — `--help`, `--version`, custom global settings
- `HelpDoc.ts` — auto-generated help formatting
- `Completions.ts` — bash/zsh/fish completion script generation
- `CliOutput.ts` — pluggable output formatter (e.g. ANSI colors)
- `CliError.ts` — typed CLI errors (`MissingOption`, `InvalidValue`, etc.)

## Decision Tree

```
What do I need?
├─ Single command, no subcommands           → Command.make("name", { flags }, handler)
├─ Command tree (parent + subcommands)      → parent.pipe(Command.withSubcommands([childA, childB]))
├─ Run from process.argv                    → Command.run(cmd, { version })
├─ Run with explicit args (testing)         → Command.runWith(cmd, { version })(["--flag", "..."])
├─ Long-form flag                           → Flag.string("name") / Flag.integer / Flag.boolean / ...
├─ Positional arg                           → Argument.string("file") / Argument.integer / ...
├─ Optional + default                       → flag.pipe(Flag.withDefault(value))
├─ Variadic positional                      → arg.pipe(Argument.variadic)
├─ Constrained choice                       → Flag.choice("env", ["dev", "staging", "prod"])
├─ Subcommand reads parent flags            → yield* parent inside child handler
├─ Hide from help (still runnable)          → Command.withHidden / Flag.withHidden (beta.69+)
├─ Interactive prompt                       → Prompt.text / Prompt.select / Prompt.confirm / Prompt.multiSelect
└─ Shell completions                        → Completions.generate(descriptor, "bash" | "zsh" | "fish")
```

## Minimal command

```ts
import { Console, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { NodeRuntime } from "@effect/platform-node"

const greet = Command.make("greet", {
  name: Flag.string("name"),
  count: Flag.integer("count").pipe(Flag.withDefault(1)),
}, (config) =>
  Effect.gen(function*() {
    for (let i = 0; i < config.count; i++) {
      yield* Console.log(`Hello, ${config.name}!`)
    }
  }))

const main = Command.run(greet, { version: "1.0.0" })

NodeRuntime.runMain(main)
```

`Command.make` overloads:
- `Command.make(name)` — bare command, no config, no handler
- `Command.make(name, config)` — config but handler attached later via `Command.withHandler`
- `Command.make(name, config, handler)` — fully wired

## Flags vs Arguments vs Params

- **Flag** (`--name`, `-n`) — `Flag.string`, `Flag.integer`, `Flag.float`, `Flag.boolean`, `Flag.date`, `Flag.choice`, `Flag.choiceWithValue`. Boolean flags accept `--no-flag` for negation.
- **Argument** (positional) — `Argument.string`, `Argument.integer`, `Argument.float`, `Argument.boolean`, `Argument.date`, `Argument.choice`, `Argument.file`, `Argument.directory`. Use `.pipe(Argument.variadic)` for `...args`.
- **`Param`** is the shared underlying type — both flags and arguments. You typically don't construct `Param` directly.

### Common combinators (work on both)

```ts
Flag.string("name").pipe(
  Flag.withDescription("User's name"),
  Flag.withAlias("n"),         // -n short form
  Flag.withDefault("anonymous"),
  Flag.optional,                // wraps in Option
)

Argument.string("path").pipe(
  Argument.withDescription("Path to process"),
  Argument.variadic,            // collect remaining args
)
```

## Nested config

Flags/arguments can be nested objects — they're flattened into a structured input:

```ts
const deploy = Command.make("deploy", {
  environment: Flag.string("env"),
  server: {
    host: Flag.string("host").pipe(Flag.withDefault("localhost")),
    port: Flag.integer("port").pipe(Flag.withDefault(3000)),
  },
  files: Argument.string("files").pipe(Argument.variadic),
  force: Flag.boolean("force"),
}, (config) =>
  // config: { environment, server: { host, port }, files: string[], force: boolean }
  Console.log(`Deploying to ${config.environment} (${config.server.host}:${config.server.port})`),
)
```

## Subcommands

```ts
import { Command, Flag } from "effect/unstable/cli"

const parent = Command.make("app").pipe(
  Command.withSharedFlags({
    verbose: Flag.boolean("verbose"),
    config: Flag.string("config"),
  }),
)

const deploy = Command.make("deploy", {
  target: Flag.string("target"),
}, (config) =>
  Effect.gen(function*() {
    // Yield the parent command tag to read its parsed flags
    const parentConfig = yield* parent
    yield* Console.log(`Verbose: ${parentConfig.verbose}, target: ${config.target}`)
  }),
)

const app = parent.pipe(Command.withSubcommands([deploy]))
// usage: app --verbose --config prod.json deploy --target staging
```

`Command.withSharedFlags(...)` declares flags inherited by all children. Children access the parent's parsed config by `yield* parent` inside their handler — Effect's service system makes parent input available as a Context.Service automatically.

## Running

```ts
// Production: read process.argv via Stdio service
const main = Command.run(myCommand, { version: "1.0.0" })

// Testing: pass args explicitly
const test = Command.runWith(myCommand, { version: "1.0.0" })
yield* test(["--name", "Alice", "--count", "2"])
yield* test(["--help"])
yield* test(["--version"])
```

`Command.run` is itself an `Effect`. It depends on `FileSystem`, `Path`, `Terminal`, `ChildProcessSpawner`, and `Stdio` services — all provided by `NodeRuntime.runMain` (and Bun/Browser equivalents).

## Prompts (interactive)

```ts
import { Effect } from "effect"
import { Prompt } from "effect/unstable/cli"

const setup = Effect.gen(function*() {
  const name = yield* Prompt.text({ message: "Project name?" })
  const language = yield* Prompt.select({
    message: "Language?",
    choices: [
      { title: "TypeScript", value: "ts" },
      { title: "JavaScript", value: "js" },
    ],
  })
  const features = yield* Prompt.multiSelect({
    message: "Features?",
    choices: [
      { title: "ESLint", value: "eslint" },
      { title: "Prettier", value: "prettier" },
      { title: "Vitest", value: "vitest" },
    ],
  })
  const confirm = yield* Prompt.confirm({ message: `Create ${name}?` })
  return { name, language, features, confirm }
})
```

Available prompt types: `text`, `password`, `hidden`, `confirm`, `toggle`, `select`, `multiSelect`, `integer`, `float`, `date`, `file`. Each takes typed options.

`Prompt.run(prompt)` is also exposed if you want to run a single prompt outside a command. Prompts depend on the `Terminal` service.

## Global flags

`GlobalFlag` extends `--help` / `--version`. Provide custom settings exposed as `Context.Service` to all handlers:

```ts
import { GlobalFlag } from "effect/unstable/cli"
import { Context } from "effect"

class LogLevel extends Context.Service<LogLevel, "info" | "debug" | "trace">()("LogLevel") {}

const logLevelFlag = GlobalFlag.setting("log-level", {
  service: LogLevel,
  flag: Flag.choice("log-level", ["info", "debug", "trace"]).pipe(Flag.withDefault("info")),
})
```

Now any handler can `yield* LogLevel` to read the parsed value.

## Typed errors

CLI errors are tagged Schema classes from `CliError.ts`:

| Error | When |
|---|---|
| `UnrecognizedOption` | Unknown flag |
| `DuplicateOption` | Same flag passed twice |
| `MissingOption` | Required flag absent |
| `MissingArgument` | Required arg absent |
| `InvalidValue` | Value failed primitive coercion |
| `UnknownSubcommand` | Subcommand name unknown |

`Command.run` returns `Effect<void, E | CliError.CliError, ...>`. Handle them at the boundary or let the runtime print them — the default formatter renders user-friendly messages.

## Output formatting

`CliOutput.Formatter` is a `Context.Reference` — provide your own to customize colors/layout:

```ts
import { CliOutput } from "effect/unstable/cli"

const layer = CliOutput.layer(CliOutput.defaultFormatter({ colors: true }))
```

## Shell completions

Generate completion scripts for `bash` / `zsh` / `fish`:

```ts
import { Completions } from "effect/unstable/cli"

const script = Completions.generate(commandDescriptor, "zsh")
```

The `commandDescriptor` is automatically built from your `Command` definition.

## Hidden commands and flags

`Command.withHidden` and `Flag.withHidden` keep entries out of generated help while still accepting them on the CLI (useful for experimental or operator-only subcommands):

```ts
const debug = Command.make("debug", {}, handler).pipe(Command.withHidden)

const verbose = Flag.boolean("verbose").pipe(Flag.withHidden)
```

## Pitfalls

- **Forgetting `NodeRuntime.runMain`** — the `main` effect requires `FileSystem | Path | Terminal | ChildProcessSpawner | Stdio`. The platform `runMain` provides all of them.
- **Subcommand context** — to read parent flags inside a subcommand, `yield* parent` (the parent `Command` value itself). `parent` is also a Context.Service tag. Don't try to thread the config manually.
- **Variadic must be last** — `Argument.variadic` consumes remaining tokens; place it after fixed positional arguments.
- **Boolean negation** — `Flag.boolean("force")` accepts both `--force` and `--no-force`. If you want only the positive form, wrap manually with a primitive.
- **Prompts in CI** — prompts read from the `Terminal` service. In non-TTY environments they fail. Detect with `Terminal.isTty` or fall back to flags.

## See Also

- [Platform](./platform.md) — `Terminal`, `FileSystem`, `Path`, `ChildProcessSpawner` services that CLI commands depend on
- [Platform Node](./platform-node.md) / [Platform Bun](./platform-bun.md) — `NodeRuntime.runMain` / `BunRuntime.runMain` entrypoints
