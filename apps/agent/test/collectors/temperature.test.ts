import { describe, expect, it } from "vitest"
import { parseThermalZone, parseHwmonSensor } from "../../src/collectors/temperature.js"

describe("parseThermalZone", () => {
  it("converts millidegrees to celsius", () => {
    const result = parseThermalZone("thermal_zone0", "45000\n")
    expect(result.celsius).toBeCloseTo(45.0, 3)
  })

  it("uses zone name as both label and source", () => {
    const result = parseThermalZone("thermal_zone0", "38500\n")
    expect(result.label).toBe("thermal_zone0")
    expect(result.source).toBe("thermal_zone0")
  })

  it("handles zero temperature", () => {
    const result = parseThermalZone("thermal_zone1", "0\n")
    expect(result.celsius).toBe(0)
  })

  it("handles large temperature values", () => {
    const result = parseThermalZone("thermal_zone0", "99000\n")
    expect(result.celsius).toBeCloseTo(99.0, 3)
  })

  it("trims whitespace from content", () => {
    const result = parseThermalZone("thermal_zone2", "   55500   \n")
    expect(result.celsius).toBeCloseTo(55.5, 3)
  })
})

describe("parseHwmonSensor", () => {
  it("converts millidegrees to celsius", () => {
    const result = parseHwmonSensor("hwmon0", "1", "67500\n", null)
    expect(result.celsius).toBeCloseTo(67.5, 3)
  })

  it("uses label when provided", () => {
    const result = parseHwmonSensor("hwmon0", "1", "67500\n", "Package id 0\n")
    expect(result.label).toBe("Package id 0")
  })

  it("falls back to generated name when label is null", () => {
    const result = parseHwmonSensor("hwmon0", "2", "55000\n", null)
    expect(result.label).toBe("hwmon0 temp2")
  })

  it("falls back to generated name when label is empty string", () => {
    const result = parseHwmonSensor("hwmon1", "1", "40000\n", "")
    expect(result.label).toBe("hwmon1 temp1")
  })

  it("sets source to hwmon_tempN format", () => {
    const result = parseHwmonSensor("hwmon0", "3", "72000\n", "Core 0")
    expect(result.source).toBe("hwmon0_temp3")
  })

  it("handles per-core labels", () => {
    const result = parseHwmonSensor("hwmon0", "2", "65000\n", "Core 0")
    expect(result.label).toBe("Core 0")
    expect(result.celsius).toBeCloseTo(65.0, 3)
  })

  it("trims whitespace from label and input", () => {
    const result = parseHwmonSensor("hwmon0", "1", "  48000  \n", "  CPU Temp  ")
    expect(result.label).toBe("CPU Temp")
    expect(result.celsius).toBeCloseTo(48.0, 3)
  })

  it("handles different hwmon indices", () => {
    const r0 = parseHwmonSensor("hwmon0", "1", "40000\n", null)
    const r1 = parseHwmonSensor("hwmon1", "1", "50000\n", null)
    expect(r0.source).toBe("hwmon0_temp1")
    expect(r1.source).toBe("hwmon1_temp1")
    expect(r0.celsius).toBeCloseTo(40.0, 3)
    expect(r1.celsius).toBeCloseTo(50.0, 3)
  })
})
