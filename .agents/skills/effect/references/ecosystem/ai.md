# AI

**Source:** `effect/unstable/ai` - see `~/Developer/effect/packages/effect/src/unstable/ai/`

> **Unstable in v4.** The core AI module is at `effect/unstable/ai`. Provider packages (`@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter`) remain separate.

Effect AI has a provider-agnostic core plus provider packages for each LLM.

## Provider Matrix

| Provider | Package | Client layer | Language-model layer |
|----------|---------|--------------|----------------------|
| OpenAI | `@effect/ai-openai` | `OpenAiClient.layer(...)` | `OpenAiLanguageModel.layer({ model, config? })` |
| Anthropic | `@effect/ai-anthropic` | `AnthropicClient.layer(...)` | `AnthropicLanguageModel.layer({ model, config? })` |
| OpenRouter | `@effect/ai-openrouter` | `OpenRouterClient.layer(...)` | `OpenRouterLanguageModel.layer({ model, config? })` |

## OpenAI Client Layer

```ts
import { FetchHttpClient } from "effect/unstable/http"
import { OpenAiClient } from "@effect/ai-openai"
import { Layer } from "effect"

const OpenAiClientLive = Layer.mergeAll(
  FetchHttpClient.layer,
  OpenAiClient.layer({})
)
```

`OpenAiClient.layer(...)` requires an `HttpClient` layer. On Node use `NodeHttpClient.layerUndici`, on Bun use `BunHttpClient.layer`, in browsers use `BrowserHttpClient.layerXMLHttpRequest`.

## Language Model Layer

```ts
import { OpenAiLanguageModel } from "@effect/ai-openai"

const ModelLive = OpenAiLanguageModel.layer({
  model: "gpt-4.1"
})
```

## Provider-Agnostic Usage

```ts
import { FetchHttpClient } from "effect/unstable/http"
import { LanguageModel } from "effect/unstable/ai"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Effect, Layer } from "effect"

const AiLive = Layer.mergeAll(
  FetchHttpClient.layer,
  OpenAiClient.layer({}),
  OpenAiLanguageModel.layer({ model: "gpt-4.1" })
)

const program = LanguageModel.generateText({
  prompt: "Say hello in one sentence."
}).pipe(Effect.provide(AiLive))
```

Swap providers by changing imports/layers, while keeping `LanguageModel` calls the same.

## Advanced Provider-Agnostic APIs

Beyond `LanguageModel.generateText`, the core AI module includes:

- `LanguageModel.generateObject(...)` for schema-constrained output
- `LanguageModel.streamText(...)` for streaming parts
- `Chat` for stateful conversations
- `EmbeddingModel` for vector embeddings
- `Tool` / `Toolkit` for tool-calling
- `Tokenizer` and `Telemetry` for token control and observability

> Snippets below assume a language-model/provider layer is already provided. To run standalone, add `.pipe(Effect.provide(AiLive))`.

### Chat (Stateful Conversation)

```ts
import { Chat } from "effect/unstable/ai"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const chat = yield* Chat.empty
  yield* chat.generateText({ prompt: "Summarize Effect in one sentence." })
  return yield* chat.exportJson
})
```

Useful constructors:
- `Chat.empty`
- `Chat.fromPrompt(...)`
- `Chat.fromJson(...)` / `Chat.fromExport(...)`
- `Chat.layerPersisted(...)` for persisted chat history

### Embeddings

```ts
import { EmbeddingModel } from "effect/unstable/ai"
import { Effect } from "effect"

const program = Effect.gen(function*() {
  const embeddings = yield* EmbeddingModel.EmbeddingModel
  return yield* embeddings.embedMany(
    ["effect systems", "typed functional programming"],
    { concurrency: 2 }
  )
})
```

### Tool Calling

```ts
import { LanguageModel, Tool, Toolkit } from "effect/unstable/ai"
import { Effect, Layer, Schema } from "effect"

const GetWeather = Tool.make("getWeather", {
  description: "Get weather by city",
  parameters: { city: Schema.String },
  success: Schema.Struct({
    temperatureC: Schema.Number,
    condition: Schema.String
  })
})

const toolkit = Toolkit.make(GetWeather)

const program = LanguageModel.generateText({
  prompt: "Do I need a jacket in San Francisco right now?",
  toolkit
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      AiLive,
      toolkit.toLayer({
        getWeather: ({ city }) =>
          Effect.succeed({ temperatureC: 14, condition: `foggy in ${city}` })
      })
    )
  )
)
```

### MCP (Model Context Protocol)

`effect/unstable/ai` includes first-class MCP support:
- Server transport layers: `McpServer.layerStdio(...)`, `McpServer.layerHttp(...)`
- Tool bridging: `McpServer.registerToolkit(toolkit)` / `McpServer.toolkit(toolkit)`
- Resource/prompt building: `McpServer.resource`, `McpServer.prompt`, `McpServer.registerResource`
- Protocol schemas: `McpSchema.*`

## Useful Constructors

- `OpenAiLanguageModel.make({ model, config? })`
- `OpenAiLanguageModel.layer({ model, config? })`
- `OpenAiLanguageModel.model(modelName, config?)`
- `OpenAiClient.layer(options)` / `OpenAiClient.layerConfig(configs)`
- `AnthropicLanguageModel.layer(...)`, `OpenRouterLanguageModel.layer(...)`

## Notes

- In v4, the core AI module (`Chat`, `LanguageModel`, `EmbeddingModel`, `Tool`, `Toolkit`, `McpServer`) moved from `@effect/ai` to `effect/unstable/ai`. Provider packages (`@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter`) remain separate.
- Keep provider package versions aligned with the `effect` version.
