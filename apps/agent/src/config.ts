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
    const hubUrl = yield* Config.string("SCOUT_HUB_URL")
    const token = yield* Config.string("SCOUT_TOKEN")
    const hostname = yield* Config.withDefault(
      Config.string("SCOUT_HOSTNAME"),
      os.hostname(),
    )
    const interval = yield* Config.withDefault(Config.number("SCOUT_INTERVAL"), 15)
    const disableStr = yield* Config.withDefault(Config.string("SCOUT_COLLECTORS_DISABLE"), "")
    const enableStr = yield* Config.withDefault(Config.string("SCOUT_COLLECTORS_ENABLE"), "")
    const pluginDir = yield* Config.withDefault(
      Config.string("SCOUT_PLUGIN_DIR"),
      DEFAULT_PLUGIN_DIR,
    )

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
