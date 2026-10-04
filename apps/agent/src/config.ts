import { Config, Effect } from "effect"
import os from "node:os"
import { fileURLToPath } from "node:url"

const DEFAULT_PLUGIN_DIR = fileURLToPath(new URL("../../../packages", import.meta.url))

export class AgentConfig {
  constructor(
    readonly hubUrl: string,
    readonly token: string,
    readonly hostname: string,
    readonly interval: number, // seconds
    readonly collectorsDisable: string[],
    readonly collectorsEnable: string[],
    readonly pluginDir: string,
  ) {}

  static readonly load = Effect.gen(function* () {
    const hubUrl = yield* Config.String("SCOUT_HUB_URL")
    const token = (yield* Config.String("SCOUT_TOKEN")).trim()
    if (token.length === 0) {
      return yield* Effect.fail(new Error("SCOUT_TOKEN must not be blank"))
    }
    const hostname = yield* Config.withDefault(Config.String("SCOUT_HOSTNAME"), os.hostname())
    const interval = yield* Config.withDefault(Config.Number("SCOUT_INTERVAL"), 15)
    const disableStr = yield* Config.withDefault(Config.String("SCOUT_COLLECTORS_DISABLE"), "")
    const enableStr = yield* Config.withDefault(Config.String("SCOUT_COLLECTORS_ENABLE"), "")
    const pluginDir = yield* Config.withDefault(Config.String("SCOUT_PLUGIN_DIR"), DEFAULT_PLUGIN_DIR)

    return new AgentConfig(
      hubUrl,
      token,
      hostname,
      interval,
      disableStr ? disableStr.split(",").map((s) => s.trim()) : [],
      enableStr ? enableStr.split(",").map((s) => s.trim()) : [],
      pluginDir,
    )
  })
}
