import { Effect } from "effect"
import fs from "node:fs"
import type { CollectorPlugin, CollectorReport, TemperatureMetrics } from "@scout/shared"

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

/**
 * Parse a thermal zone temp file (millidegrees → Celsius).
 * name: e.g. "thermal_zone0"
 * content: file content like "45000\n"
 */
export function parseThermalZone(name: string, content: string): TemperatureMetrics {
  const millidegrees = Number(content.trim())
  return {
    label: name,
    source: name,
    celsius: millidegrees / 1000,
  }
}

/**
 * Parse a hwmon sensor temp file (millidegrees → Celsius).
 * hwmon: e.g. "hwmon0"
 * index: e.g. "1" (from temp1_input)
 * input: file content like "67500\n"
 * label: content of temp1_label (or null if not present)
 */
export function parseHwmonSensor(
  hwmon: string,
  index: string,
  input: string,
  label: string | null,
): TemperatureMetrics {
  const millidegrees = Number(input.trim())
  const source = `${hwmon}_temp${index}`
  const resolvedLabel = label?.trim() || `${hwmon} temp${index}`
  return {
    label: resolvedLabel,
    source,
    celsius: millidegrees / 1000,
  }
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

const tryReadFile = (path: string): Effect.Effect<string | null> =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)))

const readDir = (path: string): Effect.Effect<string[]> =>
  Effect.tryPromise({
    try: async () => {
      const entries = await fs.promises.readdir(path)
      return entries
    },
    catch: () => [] as string[],
  }).pipe(Effect.catch(() => Effect.succeed([] as string[])))

// ---------------------------------------------------------------------------
// Collect helpers
// ---------------------------------------------------------------------------

const collectThermalZones = (): Effect.Effect<TemperatureMetrics[]> =>
  Effect.gen(function* () {
    const entries = yield* readDir("/sys/class/thermal")
    const zones = entries.filter((e) => e.startsWith("thermal_zone"))

    const results: TemperatureMetrics[] = []

    for (const zone of zones) {
      const content = yield* tryReadFile(`/sys/class/thermal/${zone}/temp`)
      if (content === null) continue
      const celsius = Number(content.trim()) / 1000
      if (!isFinite(celsius) || celsius <= 0 || celsius >= 200) continue
      results.push(parseThermalZone(zone, content))
    }

    return results
  })

const collectHwmonSensors = (): Effect.Effect<TemperatureMetrics[]> =>
  Effect.gen(function* () {
    const hwmons = yield* readDir("/sys/class/hwmon")
    const results: TemperatureMetrics[] = []

    for (const hwmon of hwmons) {
      const base = `/sys/class/hwmon/${hwmon}`
      // List files to find temp*_input
      const files = yield* readDir(base)
      const inputFiles = files.filter((f) => /^temp\d+_input$/.test(f))

      for (const inputFile of inputFiles) {
        const indexMatch = inputFile.match(/^temp(\d+)_input$/)
        if (!indexMatch) continue
        const index = indexMatch[1]!

        const input = yield* tryReadFile(`${base}/${inputFile}`)
        if (input === null) continue

        const celsius = Number(input.trim()) / 1000
        if (!isFinite(celsius) || celsius <= 0 || celsius >= 200) continue

        const label = yield* tryReadFile(`${base}/temp${index}_label`)
        results.push(parseHwmonSensor(hwmon, index, input, label))
      }
    }

    return results
  })

// ---------------------------------------------------------------------------
// CollectorPlugin
// ---------------------------------------------------------------------------

export const temperatureCollector: CollectorPlugin = {
  name: "temperature",
  capability: "temperature",
  detect: Effect.sync(() => fs.existsSync("/sys/class/thermal") || fs.existsSync("/sys/class/hwmon")),
  collect: Effect.gen(function* () {
    const [thermal, hwmon] = yield* Effect.all([collectThermalZones(), collectHwmonSensors()])

    const temperatures: TemperatureMetrics[] = [...thermal, ...hwmon]

    return {
      capability: "temperature" as const,
      data: temperatures,
    } satisfies CollectorReport
  }),
}

export type { TemperatureMetrics }
