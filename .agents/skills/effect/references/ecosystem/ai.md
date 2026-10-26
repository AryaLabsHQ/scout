# AI

## Table of Contents

- [Provider Matrix](#provider-matrix)
- [OpenAI Client Layer](#openai-client-layer)
- [Language Model Layer](#language-model-layer)
- [Provider-Agnostic Usage](#provider-agnostic-usage)
- [Advanced Provider-Agnostic APIs](#advanced-provider-agnostic-apis)
- [Decisions](#decisions)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
- [Useful Constructors](#useful-constructors)
- [Notes](#notes)

**Source:** `effect/ai` - see

`~/Developer/effect/packages/effect/src/ai/`

> **API stability.** The core AI module is at `effect/ai`; its APIs are tagged
> `@stability unstable`. Provider packages (`@effect/ai-openai`, `@effect/ai-openai-compat`,
> `@effect/ai-anthropic`, `@effect/ai-openrouter`, `@effect/ai-cloudflare`, `@effect/ai-typesafe`)
> are separate. `McpClient` is `@stability experimental`.

Effect AI has a provider-agnostic core plus provider packages for each LLM.

## Provider Matrix

| Provider / use case    | Package                    | Client layer                  | Language-model layer                                |
| ---------------------- | -------------------------- | ----------------------------- | --------------------------------------------------- |
| OpenAI                 | `@effect/ai-openai`        | `OpenAiClient.layer(...)`     | `OpenAiLanguageModel.layer({ model, config? })`     |
| OpenAI-compatible APIs | `@effect/ai-openai-compat` | `OpenAiClient.layer(...)`     | `OpenAiLanguageModel.layer({ model, config? })`     |
| Anthropic              | `@effect/ai-anthropic`     | `AnthropicClient.layer(...)`  | `AnthropicLanguageModel.layer({ model, config? })`  |
| OpenRouter             | `@effect/ai-openrouter`    | `OpenRouterClient.layer(...)` | `OpenRouterLanguageModel.layer({ model, config? })` |

`@effect/ai-cloudflare` (Cloudflare Workers AI) and `@effect/ai-typesafe` provide
[`DecisionModel`](#decisions) layers only, not `LanguageModel`.

## OpenAI Client Layer

```ts
import { FetchHttpClient } from "effect/http";
import { OpenAiClient } from "@effect/ai-openai";
import { Layer } from "effect";

const OpenAiClientLive = Layer.mergeAll(FetchHttpClient.layer, OpenAiClient.layer({}));
```

`OpenAiClient.layer(...)` requires an `HttpClient` layer. On Node use `NodeHttpClient.layerUndici`,
on Bun use `BunHttpClient.layer`, in browsers use `BrowserHttpClient.layerXMLHttpRequest`.

## Language Model Layer

```ts
import { FetchHttpClient } from "effect/http";
import { OpenAiLanguageModel } from "@effect/ai-openai";
import { OpenAiClient } from "@effect/ai-openai";
import { Layer } from "effect";

const ModelLive = Layer.mergeAll(
  FetchHttpClient.layer,
  OpenAiClient.layer({}),
  OpenAiLanguageModel.layer({ model: "gpt-4.1" }),
);
```

## Provider-Agnostic Usage

```ts
import { FetchHttpClient } from "effect/http";
import { LanguageModel } from "effect/ai";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { Effect, Layer } from "effect";

const AiLive = Layer.mergeAll(
  FetchHttpClient.layer,
  OpenAiClient.layer({}),
  OpenAiLanguageModel.layer({ model: "gpt-4.1" }),
);

const program = LanguageModel.generateText({
  prompt: "Say hello in one sentence.",
}).pipe(Effect.provide(AiLive));
```

Swap providers by changing imports/layers, while keeping `LanguageModel` calls the same.

Unrecognized OpenAI model names are treated as reasoning models. `@effect/ai-openai` also exports
`OpenAiEmbeddingModel`.

`@effect/ai-openai-compat` uses the same client/model shapes for OpenAI-compatible endpoints. Pass
`apiUrl` to `OpenAiClient.layer({ apiUrl, ... })` (or use `layerConfig`) and use its exported
`OpenAiEmbeddingModel` for compatible embedding APIs. Chat Completions requests replay assistant
reasoning, text, and tool calls in one message; the reasoning field name (`reasoning` or
`reasoning_content`, default `reasoning_content`) is kept per provider via the `reasoningField` part
option, and tool call `extra_content` (such as Gemini thought signatures) round-trips as
`extraContent`. Provider metadata, errors, and part options use the `"openai-compat"` key.

## Advanced Provider-Agnostic APIs

Beyond `LanguageModel.generateText`, the core AI module includes:

- `LanguageModel.generateObject(...)` for schema-constrained output
- `LanguageModel.streamText(...)` for streaming parts
- `Chat` for stateful conversations
- `EmbeddingModel` for vector embeddings
- `Tool` / `Toolkit` for tool-calling
- `Tokenizer` and `Telemetry` for token control and observability

Core options worth knowing:

- `disableToolCallResolution: true` returns tool calls without running handlers. Add
  `toolCallValidation: "deferred"` to get model-generated calls back with `unknown` parameters
  (including invalid parameters and undeclared tool names, even without a toolkit) so the caller
  validates them. Strict validation is the default. Supported by the Anthropic, OpenAI, and
  OpenAI-compat providers.
- Provider response schema or SSE decoding failures surface as non-retryable
  `AiError.InvalidResponseError`.
- Chat history containing `Prompt.FilePart` bytes or URLs round-trips through `exportJson` /
  `Chat.fromJson` and persistence.

> Snippets below assume a language-model/provider layer is already provided. To run standalone, add
> `.pipe(Effect.provide(AiLive))`.

### Chat (Stateful Conversation)

```ts
import { Chat } from "effect/ai";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const chat = yield* Chat.empty;
  yield* chat.generateText({ prompt: "Summarize Effect in one sentence." });
  return yield* chat.exportJson;
});
```

Useful constructors:

- `Chat.empty`
- `Chat.fromPrompt(...)`
- `Chat.fromJson(...)` / `Chat.fromExport(...)`
- `Chat.layerPersisted(...)` for persisted chat history

### Embeddings

```ts
import { EmbeddingModel } from "effect/ai";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const embeddings = yield* EmbeddingModel.EmbeddingModel;
  return yield* embeddings.embedMany(["effect systems", "typed functional programming"]);
});
```

### Tool Calling

```ts
import { LanguageModel, Tool, Toolkit } from "effect/ai";
import { Effect, Layer, Schema } from "effect";

const GetWeather = Tool.make("getWeather", {
  description: "Get weather by city",
  parameters: Schema.Struct({ city: Schema.String }),
  success: Schema.Struct({
    temperatureC: Schema.Number,
    condition: Schema.String,
  }),
});

const toolkit = Toolkit.make(GetWeather);

const program = LanguageModel.generateText({
  prompt: "Do I need a jacket in San Francisco right now?",
  toolkit,
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      AiLive,
      toolkit.toLayer({
        getWeather: ({ city }) =>
          Effect.succeed({ temperatureC: 14, condition: `foggy in ${city}` }),
      }),
    ),
  ),
);
```

## Decisions

`Decision` / `DecisionModel` ask a model for scored judgments about an input in one provider call:
`Decision.classify` (unordered labels), `Decision.rate` (ordered levels), `Decision.probability`
(yes/no likelihood). Instructions and descriptions may be strings or JSON values.

```ts
import { Effect, Schema } from "effect";
import { Decision, DecisionModel } from "effect/ai";

const Triage = Decision.make({
  input: Schema.String,
  decisions: {
    department: Decision.classify({
      instructions: "Which team should handle this",
      criteria: { billing: "payments", technical: "bugs" },
    }),
    severity: Decision.rate({
      instructions: "How severe is the issue",
      criteria: ["cosmetic", { label: "blocking", description: "No workaround exists" }],
    }),
    urgent: Decision.probability({ instructions: "The message is time-sensitive" }),
  },
});

const program = Effect.gen(function* () {
  // decide: fails unless every decision is answered
  const { answers, usage, modelId } = yield* DecisionModel.decide(Triage, {
    input: "My card was charged twice, please fix this today",
    // images: [{ mediaType: "image/png", data: bytes }]  (providers with image support)
  });
  // decideSettled: per-decision Result<answer, Unanswered> ("Missing" | "Refused" | "NoDistribution" | "Invalid")
  const { outcomes } = yield* DecisionModel.decideSettled(Triage, { input: "..." });
  return { answers, outcomes };
});
```

Provide one of the decision-model layers (each needs its client layer and an `HttpClient`):

| Provider   | Package                 | Layer                                                                 |
| ---------- | ----------------------- | --------------------------------------------------------------------- |
| OpenAI     | `@effect/ai-openai`     | `OpenAiDecisionModel.layer({ model: "gpt-6-luna" })` (Decisions API)  |
| Cloudflare | `@effect/ai-cloudflare` | `CloudflareDecisionModel.layer({ model: "clef-flash" })` or `"clef"`  |
| OpenRouter | `@effect/ai-openrouter` | `OpenRouterDecisionModel.layer({ model })` (reports cost in metadata) |
| TypeSafe   | `@effect/ai-typesafe`   | `TypeSafeDecisionModel.layer({ model: "jev-latest" })`                |

`CloudflareClient.layerConfig()` reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; set
`CLOUDFLARE_AI_GATEWAY_ID` (or `gatewayId` on `CloudflareClient.layer`) to route through AI Gateway.
Image `data` may be bytes, base64, or a `data:` URL; remote URLs fail with `InvalidUserInputError`.

## MCP (Model Context Protocol)

`effect/ai` includes MCP server and client support. Protocol revisions are chosen with `McpProtocol`
adapters (`v2026_07_28`, `v2025_11_25`, `v2025_06_18`, `v2025_03_26`, `v2024_11_05`); `v2026_07_28`
is sessionless.

Server:

- Transport layers: `McpServer.layerStdio({ name, version, protocols })`,
  `McpServer.layerHttp({ name, version, path, protocols, ... })`
- `layerHttp` options: `allowedOrigins`, `allowSessionTermination` (DELETE ends a session),
  `allowSubscriptions: false` (disables `v2026_07_28` subscriptions; request-scoped progress/logs
  still work)
- `McpServer.layerHttpRequestScoped(...)` for serverless hosts such as Cloudflare Workers: each POST
  runs its own server in the request scope, so no fiber or timer outlives the request. Sessionless
  protocols only; no subscriptions, session termination, or list-change broadcasts.
- Tool bridging: `McpServer.registerToolkit(toolkit)` / `McpServer.toolkit(toolkit)`
- Resource/prompt building: `McpServer.resource`, `McpServer.prompt`, `McpServer.registerResource`,
  `McpServer.registerPrompt`. Completion handlers' service requirements (and schema/encoding
  services for resource templates and prompt parameters) appear in the layer's `R`, so missing
  services fail at compile time.
- Protocol schemas: `McpSchema.*`

Client (`McpClient`, experimental): a scoped client over stdio or Streamable HTTP for the
`2025-11-25` and `2026-07-28` revisions. It discovers tools, prompts, and resources, calls tools
with optional schema decoding, and exposes remote tools to a model via `McpClient.toolkit`. OAuth,
subscriptions, interactive server requests, and retries are not included.

```ts
import { Effect, Layer } from "effect";
import { LanguageModel, McpClient, McpProtocol } from "effect/ai";
import { FetchHttpClient } from "effect/http";

const ClientLive = McpClient.layerHttp({
  name: "my-app",
  version: "1.0.0",
  protocol: McpProtocol.v2026_07_28,
  url: "http://localhost:3000/mcp",
}).pipe(Layer.provide(FetchHttpClient.layer));
// McpClient.layerStdio({ ..., command: ChildProcess.make(...), protocol }) for subprocess servers

const program = Effect.gen(function* () {
  const client = yield* McpClient.McpClient;
  const tools = yield* client.listTools();
  const toolkit = yield* McpClient.toolkit(client, "reports__"); // optional name prefix
  return yield* LanguageModel.generateText({ prompt: "Summarize the reports", toolkit });
});
```

`callTool({ tool, arguments, schema? })` returns tool-reported errors as results unless a `schema`
is supplied (then a `ToolError` reason retains the original result). Failures are `McpClientError`s.
Build a new toolkit to pick up tool changes between model turns.

## Useful Constructors

- `OpenAiLanguageModel.make({ model, config? })`
- `OpenAiLanguageModel.layer({ model, config? })`
- `OpenAiLanguageModel.model(modelName, config?)`
- `OpenAiClient.layer(options)` / `OpenAiClient.layerConfig(configs)`
- `AnthropicLanguageModel.layer(...)`, `OpenRouterLanguageModel.layer(...)`

## Notes

- The core AI module (`Chat`, `LanguageModel`, `EmbeddingModel`, `Decision`, `DecisionModel`,
  `Tool`, `Toolkit`, `McpServer`, `McpClient`) lives in `effect/ai`; there is no `@effect/ai`
  package. Provider packages are separate. The compatibility provider keeps the same provider
  interfaces while targeting OpenAI-compatible endpoints.
- Keep provider package versions aligned with the `effect` version.
