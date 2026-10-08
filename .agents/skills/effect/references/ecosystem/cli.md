# CLI

## Table of Contents

- [Decision Tree](#decision-tree)
- [Minimal command](#minimal-command)
- [Flags vs Arguments vs Params](#flags-vs-arguments-vs-params)
- [Nested config](#nested-config)
- [Subcommands](#subcommands)
- [Running](#running)
- [Prompts (interactive)](#prompts-interactive)
- [Global flags](#global-flags)
- [Typed errors](#typed-errors)
- [Output formatting](#output-formatting)
- [Status via logging and --log-level](#status-via-logging-and---log-level)
- [Shell completions](#shell-completions)
- [Hidden commands and flags](#hidden-commands-and-flags)
- [Pitfalls](#pitfalls)
- [See Also](#see-also)

  > **API stability: `@stability unstable`.** Build typed CLIs from Effect programs. The module
  > lives at `effect/cli` — there is no separate `@effect/cli` package in v4.

**Source:** `effect/cli/*` - see `~/Developer/effect/packages/effect/src/cli/`

- `Command.ts` — command definition, composition, `run` / `runWith`
- `Flag.ts` — long-form flags (`--name`)
- `Argument.ts` — positional arguments
- `Param.ts` — shared primitive of flags + arguments
- `Primitive.ts` — typed coercion (`String`, `Int`, `Finite`, `Boolean`, `Date`, etc.)
- `Prompt.ts` — interactive prompts (`String`, `Select`, `Confirm`, `MultiSelect`, `Password`, etc.)
- `GlobalFlag.ts` — `--help`, `--version`, custom global settings
- `HelpDoc.ts` — auto-generated help formatting
- `Completions.ts` — bash/zsh/fish completion script generation
- `CliOutput.ts` — pluggable output formatter (e.g. ANSI colors)
- `CliError.ts` — typed CLI errors (`MissingOption`, `InvalidValue`, etc.)

> **PascalCase constructors (rc.113).** `Primitive`, `Param`, `Flag`, `Argument`, `Prompt`, and
> `GlobalFlag` constructors are PascalCase at the current baseline. `Flag.String`, `Flag.Int`,
> `Flag.Finite`, `Flag.Boolean`, `Flag.Date`, `Flag.Literals`, `Flag.ChoiceWithValue` and their
> `Argument.*` equivalents; `Prompt.String` / `Prompt.Int` / `Prompt.Number` / `Prompt.Select` /
> `Prompt.Confirm` / `Prompt.MultiSelect`; `GlobalFlag.Action` / `GlobalFlag.Setting`. `choice` is
> now `Literals` (arrays of literals), not a casing change. Primitive `_tag` values are `"Int"`,
> `"Finite"`, and `"Never"` (previously `"Integer"`, `"Float"`, `"None"`). Combinators such as
> `withDefault`, `optional`, `withAlias`, `withDescription`, `map`, and `variadic` keep their names.

## Decision Tree

```
What do I need?
├─ Single command, no subcommands           → Command.make("name", { flags }, handler)
├─ Command tree (parent + subcommands)      → parent.pipe(Command.withSubcommands([childA, childB]))
├─ Run from process.argv                    → Command.run(cmd, { version })
├─ Run with explicit args (testing)         → Command.runWith(cmd, { version })(["--flag", "..."])
├─ Long-form flag                           → Flag.String("name") / Flag.Int / Flag.Boolean / ...
├─ Positional arg                           → Argument.String("file") / Argument.Int / ...
├─ Optional + default                       → flag.pipe(Flag.withDefault(value))
├─ Variadic positional                      → arg.pipe(Argument.variadic)
├─ Constrained choice                       → Flag.Literals("env", ["dev", "staging", "prod"])
├─ Subcommand reads parent flags            → yield* parent inside child handler
├─ Hide from help (still runnable)          → Command.unlisted / Flag.withHidden
├─ Interactive prompt                       → Prompt.String / Prompt.Select / Prompt.Confirm / Prompt.MultiSelect
└─ Shell completions                        → Completions.generate(descriptor, "bash" | "zsh" | "fish")
```

## Minimal command

```ts
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { NodeRuntime } from "@effect/platform-node";

const greet = Command.make(
  "greet",
  {
    name: Flag.String("name"),
    count: Flag.Int("count").pipe(Flag.withDefault(1)),
  },
  (config) =>
    Effect.gen(function* () {
      for (let i = 0; i < config.count; i++) {
        yield* Console.log(`Hello, ${config.name}!`);
      }
    }),
);

const main = Command.run(greet, { version: "1.0.0" });

NodeRuntime.runMain(main);
```

`Command.make` overloads:

- `Command.make(name)` — bare command, no config, no handler
- `Command.make(name, config)` — config but handler attached later via `Command.withHandler`
- `Command.make(name, config, handler)` — fully wired

## Flags vs Arguments vs Params

- **Flag** (`--name`, `-n`) — `Flag.String`, `Flag.Int`, `Flag.Finite`, `Flag.Boolean`, `Flag.Date`,
  `Flag.Literals`, `Flag.ChoiceWithValue`. Boolean flags accept `--no-flag` for negation.
- **Argument** (positional) — `Argument.String`, `Argument.Int`, `Argument.Finite`, `Argument.Date`,
  `Argument.Literals`, `Argument.ChoiceWithValue`, `Argument.File`, `Argument.Directory`. Use
  `.pipe(Argument.variadic)` for `...args`. Positional booleans do not exist; use a boolean flag.
- **`Param`** is the shared underlying type — both flags and arguments. You typically don't
  construct `Param` directly.

### Common combinators (work on both)

```ts
Flag.String("name").pipe(
  Flag.withDescription("User's name"),
  Flag.withAlias("n"), // -n short form
  Flag.withDefault("anonymous"),
  Flag.optional, // wraps in Option
);

Argument.String("path").pipe(
  Argument.withDescription("Path to process"),
  Argument.variadic, // collect remaining args
);
```

## Nested config

Flags/arguments can be nested objects — they're flattened into a structured input:

```ts
const deploy = Command.make(
  "deploy",
  {
    environment: Flag.String("env"),
    server: {
      host: Flag.String("host").pipe(Flag.withDefault("localhost")),
      port: Flag.Int("port").pipe(Flag.withDefault(3000)),
    },
    files: Argument.String("files").pipe(Argument.variadic),
    force: Flag.Boolean("force"),
  },
  (config) =>
    // config: { environment, server: { host, port }, files: string[], force: boolean }
    Console.log(`Deploying to ${config.environment} (${config.server.host}:${config.server.port})`),
);
```

## Subcommands

```ts
import { Command, Flag } from "effect/cli";

const parent = Command.make("app").pipe(
  Command.withSharedFlags({
    verbose: Flag.Boolean("verbose"),
    config: Flag.String("config"),
  }),
);

const deploy = Command.make(
  "deploy",
  {
    target: Flag.String("target"),
  },
  (config) =>
    Effect.gen(function* () {
      // Yield the parent command tag to read its parsed flags
      const parentConfig = yield* parent;
      yield* Console.log(`Verbose: ${parentConfig.verbose}, target: ${config.target}`);
    }),
);

const app = parent.pipe(Command.withSubcommands([deploy]));
// usage: app --verbose --config prod.json deploy --target staging
```

`Command.withSharedFlags(...)` declares flags inherited by all children. Children access the
parent's parsed config by `yield* parent` inside their handler — Effect's service system makes
parent input available as a Context.Service automatically.

## Running

```ts
// Production: read process.argv via Stdio service
const main = Command.run(myCommand, { version: "1.0.0" });

// Testing: pass args explicitly
const test = Command.runWith(myCommand, { version: "1.0.0" });
yield * test(["--name", "Alice", "--count", "2"]);
yield * test(["--help"]);
yield * test(["--version"]);
```

`Command.run` is itself an `Effect`. It depends on `FileSystem`, `Path`, `Terminal`,
`ChildProcessSpawner`, and `Stdio` services — all provided by `NodeRuntime.runMain` (and Bun/Browser
equivalents).

## Prompts (interactive)

```ts
import { Effect } from "effect";
import { Prompt } from "effect/cli";

const setup = Effect.gen(function* () {
  const name = yield* Prompt.String({ message: "Project name?" });
  const language = yield* Prompt.Select({
    message: "Language?",
    choices: [
      { title: "TypeScript", value: "ts" },
      { title: "JavaScript", value: "js" },
    ],
  });
  const features = yield* Prompt.MultiSelect({
    message: "Features?",
    choices: [
      { title: "ESLint", value: "eslint" },
      { title: "Prettier", value: "prettier" },
      { title: "Vitest", value: "vitest" },
    ],
  });
  const confirm = yield* Prompt.Confirm({ message: `Create ${name}?` });
  return { name, language, features, confirm };
});
```

Available prompt types: `String`, `Password`, `Hidden`, `Confirm`, `Toggle`, `Select`,
`MultiSelect`, `Int`, `Number`, `Date`, `File`. Each takes typed options. Since rc.114 the `message`
option is optional for `Prompt.Select` and `Prompt.MultiSelect`; `Prompt.AutoComplete` still
requires it.

`Prompt.run(prompt)` is also exposed if you want to run a single prompt outside a command. Prompts
depend on the `Terminal` service.

Theme symbols and colors through `Prompt.Theme`, or a per-prompt `theme` option. Do not pass
`prefix` on individual prompts. That option is gone.

## Global flags

`GlobalFlag` extends the built-ins (`--help` / `--version` / `--log-level`). Provide custom settings
exposed as `Context.Service` to all handlers:

```ts
import { Flag, GlobalFlag } from "effect/cli";

const Profile = GlobalFlag.Setting("profile")({
  flag: Flag.String("profile").pipe(Flag.withDefault("default")),
});
```

The returned setting is the service. Add it with `Command.withGlobalFlags([Profile])`; any handler
can then `yield* Profile` to read the parsed value.

Do **not** define a custom log-level setting — `--log-level` already exists as a built-in that
provides `References.MinimumLogLevel` (see
[Status via logging](#status-via-logging-and---log-level)). `GlobalFlag.Setting` is for settings the
built-ins don't cover.

## Typed errors

CLI errors are tagged Schema classes from `CliError.ts`:

| Error                | When                            |
| -------------------- | ------------------------------- |
| `UnrecognizedOption` | Unknown flag                    |
| `DuplicateOption`    | Same flag passed twice          |
| `MissingOption`      | Required flag absent            |
| `MissingArgument`    | Required arg absent             |
| `InvalidValue`       | Value failed primitive coercion |
| `UnknownSubcommand`  | Subcommand name unknown         |

`Command.run` returns `Effect<void, E | CliError.CliError, ...>`. Handle them at the boundary or let
the runtime print them — the default formatter renders user-friendly messages.

## Output formatting

`CliOutput.Formatter` is a `Context.Reference` — provide your own to customize colors/layout:

```ts
import { CliOutput } from "effect/cli";

const layer = CliOutput.layer(CliOutput.defaultFormatter({ colors: true }));
```

## Status via logging and --log-level

`Command.run` parses the built-in `--log-level <all|trace|debug|info|warn|error|fatal|none>` flag
and, **only when the flag is passed**, provides `References.MinimumLogLevel` with the chosen level
around the program. Otherwise the reference default (`"Info"`) applies. Status emitted with
`Effect.logInfo` / `Effect.logDebug` / `Effect.logWarning` therefore honors the flag with no
plumbing.

Replace the default timestamped logger with a minimal one at the entrypoint so log output reads as
CLI status. `message` may be a single value or an array — normalize:

```ts
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";

const cliLogger = Logger.make(({ logLevel, message }) => {
  const text = (Array.isArray(message) ? message : [message]).map(String).join(" ");
  const stream = LogLevel.isGreaterThanOrEqualTo(logLevel, "Warn")
    ? process.stderr
    : process.stdout;
  stream.write(`${text}\n`);
});

const program = Command.run(cli, { version }).pipe(
  Effect.provide(Logger.layer([cliLogger])), // replaces CurrentLoggers
  Effect.provide(BunServices.layer),
);
```

Related mechanics:

- Silence a pipeline (e.g. when `--json` owns stdout, or in a test harness — in-process tests
  otherwise hit the default timestamped logger):
  `Effect.provideService(References.MinimumLogLevel, "None")`. Inner provides win over the flag.
- Gate non-log terminal UI (a `\r` progress ticker) on the level:
  `if (yield* LogLevel.isEnabled("Info")) { … }`.
- `LogLevel` is a string union
  (`"All" | "Fatal" | "Error" | "Warn" | "Info" | "Debug" | "Trace" | "None"`), so levels are passed
  as plain strings. Compare with the severity ordering (`LogLevel.isGreaterThanOrEqualTo`,
  `LogLevel.Order`), not string equality chains.

**Source** for API shapes beyond this recipe:

- `~/Developer/effect/packages/effect/src/Logger.ts` — `Logger.make` options (`message` may be a
  value or array), `Logger.layer`, `withConsoleLog`/`withConsoleError`, format loggers
- `~/Developer/effect/packages/effect/src/LogLevel.ts` — the union, `isEnabled`, ordering helpers
- `~/Developer/effect/packages/effect/src/References.ts` — `MinimumLogLevel`, `CurrentLoggers` and
  the other ambient `Context.Reference` defaults
- `~/Developer/effect/packages/effect/src/cli/Command.ts` (`Command.run`) — where `run` parses
  `--log-level` and provides `References.MinimumLogLevel` only when the flag is present

## Shell completions

Generate completion scripts for `bash` / `zsh` / `fish`:

```ts
import { Completions } from "effect/cli";

const script = Completions.generate(commandDescriptor, "zsh");
```

The `commandDescriptor` is automatically built from your `Command` definition.

## Hidden commands and flags

`Command.unlisted` and `Flag.withHidden` keep entries out of generated help while still accepting
them on the CLI (useful for experimental or operator-only subcommands):

```ts
const debug = Command.make("debug", {}, handler).pipe(Command.unlisted);

const verbose = Flag.Boolean("verbose").pipe(Flag.withHidden);
```

## Pitfalls

- **Forgetting `NodeRuntime.runMain`** — the `main` effect requires
  `FileSystem | Path | Terminal | ChildProcessSpawner | Stdio`. The platform `runMain` provides all
  of them.
- **Subcommand context** — to read parent flags inside a subcommand, `yield* parent` (the parent
  `Command` value itself). `parent` is also a Context.Service tag. Don't try to thread the config
  manually.
- **Variadic must be last** — `Argument.variadic` consumes remaining tokens; place it after fixed
  positional arguments.
- **Boolean negation** — `Flag.Boolean("force")` accepts both `--force` and `--no-force`. If you
  want only the positive form, wrap manually with a primitive.
- **Prompts in CI** — prompts read from the `Terminal` service. In non-TTY environments they fail.
  Detect with `Terminal.isTty` or fall back to flags.

## See Also

- [Platform](./platform.md) — `Terminal`, `FileSystem`, `Path`, `ChildProcessSpawner` services that
  CLI commands depend on
- [Platform Node](./platform-node.md) / [Platform Bun](./platform-bun.md) — `NodeRuntime.runMain` /
  `BunRuntime.runMain` entrypoints
- `building-clis` skill — CLI design taste: command structure, output surfaces, agent/machine
  contracts, and testing. This file is the API; that skill is what good looks like.
