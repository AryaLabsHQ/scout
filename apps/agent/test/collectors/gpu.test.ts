import { describe, expect, it } from "vitest"
import { parseNvidiaSmiOutput } from "../../src/collectors/gpu.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SINGLE_GPU = `NVIDIA GeForce RTX 4090, 0, 45, 4096, 24576, 65, 120.50`

const MULTI_GPU = `NVIDIA GeForce RTX 4090, 0, 45, 4096, 24576, 65, 120.50
NVIDIA GeForce RTX 3070, 1, 30, 2048, 8192, 55, 80.00`

const MALFORMED_LINE = `NVIDIA GeForce RTX 4090, 0, 45, 4096, 24576, 65, 120.50
, , , , , ,
This line has no useful data`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseNvidiaSmiOutput", () => {
  it("parses single GPU correctly", () => {
    const result = parseNvidiaSmiOutput(SINGLE_GPU)
    expect(result).toHaveLength(1)
    const gpu = result[0]!
    expect(gpu.name).toBe("NVIDIA GeForce RTX 4090")
    expect(gpu.index).toBe(0)
    expect(gpu.usage).toBe(45)
    expect(gpu.memUsed).toBe(4096 * 1024 * 1024)
    expect(gpu.memTotal).toBe(24576 * 1024 * 1024)
    expect(gpu.temperature).toBe(65)
    expect(gpu.powerWatts).toBeCloseTo(120.5)
  })

  it("parses multiple GPUs with correct indices", () => {
    const result = parseNvidiaSmiOutput(MULTI_GPU)
    expect(result).toHaveLength(2)

    expect(result[0]!.name).toBe("NVIDIA GeForce RTX 4090")
    expect(result[0]!.index).toBe(0)

    expect(result[1]!.name).toBe("NVIDIA GeForce RTX 3070")
    expect(result[1]!.index).toBe(1)
    expect(result[1]!.usage).toBe(30)
    expect(result[1]!.memUsed).toBe(2048 * 1024 * 1024)
    expect(result[1]!.memTotal).toBe(8192 * 1024 * 1024)
    expect(result[1]!.temperature).toBe(55)
    expect(result[1]!.powerWatts).toBeCloseTo(80.0)
  })

  it("returns empty array for empty output", () => {
    expect(parseNvidiaSmiOutput("")).toEqual([])
    expect(parseNvidiaSmiOutput("   \n   \n")).toEqual([])
  })

  it("skips malformed lines gracefully", () => {
    const result = parseNvidiaSmiOutput(MALFORMED_LINE)
    // Only the first valid line should be kept
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("NVIDIA GeForce RTX 4090")
  })

  it("converts memory from MB to bytes", () => {
    const result = parseNvidiaSmiOutput(SINGLE_GPU)
    // 4096 MB = 4096 * 1024 * 1024 = 4294967296 bytes
    expect(result[0]!.memUsed).toBe(4294967296)
    // 24576 MB = 24576 * 1024 * 1024 = 25769803776 bytes
    expect(result[0]!.memTotal).toBe(25769803776)
  })

  it("handles lines with extra whitespace around values", () => {
    const padded = `  NVIDIA Tesla V100 ,  0 ,  70 ,  8192 ,  16384 ,  72 ,  250.00  `
    const result = parseNvidiaSmiOutput(padded)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("NVIDIA Tesla V100")
    expect(result[0]!.usage).toBe(70)
  })
})
