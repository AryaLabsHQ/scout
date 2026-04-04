import { describe, expect, it } from "vitest"
import { parseLsblkOutput, parseSmartctlJson } from "../../src/collectors/smart.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LSBLK_OUTPUT = `/dev/sda disk
/dev/sdb disk
/dev/sdc disk
/dev/sda1 part
/dev/sda2 part
/dev/nvme0n1 disk
`

const SMARTCTL_SATA_JSON = JSON.stringify({
  model_name: "Samsung SSD 870 EVO 1TB",
  serial_number: "S123456789",
  smart_status: { passed: true },
  temperature: { current: 35 },
  power_on_time: { hours: 12345 },
  ata_smart_attributes: {
    table: [
      { id: 5, name: "Reallocated_Sector_Ct", raw: { value: 0 } },
      { id: 9, name: "Power_On_Hours", raw: { value: 12345 } },
      { id: 194, name: "Temperature_Celsius", raw: { value: 35 } },
    ],
  },
})

const SMARTCTL_NVME_JSON = JSON.stringify({
  model_name: "Samsung 980 PRO 1TB",
  serial_number: "N987654321",
  smart_status: { passed: true },
  temperature: { current: 40 },
  power_on_time: { hours: 5678 },
  nvme_smart_health_information_log: {
    critical_warning: 0,
  },
})

const SMARTCTL_FAILED_JSON = JSON.stringify({
  model_name: "WDC WD10EARS",
  serial_number: "WD-XYZ123",
  smart_status: { passed: false },
  temperature: { current: 50 },
  power_on_time: { hours: 30000 },
  ata_smart_attributes: {
    table: [
      { id: 5, name: "Reallocated_Sector_Ct", raw: { value: 247 } },
    ],
  },
})

const SMARTCTL_MISSING_FIELDS_JSON = JSON.stringify({
  model_name: "Some Drive",
  serial_number: "SERIAL001",
  smart_status: { passed: true },
  // No temperature, no power_on_time, no ata_smart_attributes
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseLsblkOutput", () => {
  it("returns only disk-type devices", () => {
    const result = parseLsblkOutput(LSBLK_OUTPUT)
    expect(result).toContain("/dev/sda")
    expect(result).toContain("/dev/sdb")
    expect(result).toContain("/dev/sdc")
    expect(result).toContain("/dev/nvme0n1")
  })

  it("excludes partitions", () => {
    const result = parseLsblkOutput(LSBLK_OUTPUT)
    expect(result).not.toContain("/dev/sda1")
    expect(result).not.toContain("/dev/sda2")
  })

  it("returns correct device count", () => {
    const result = parseLsblkOutput(LSBLK_OUTPUT)
    expect(result).toHaveLength(4)
  })

  it("returns empty array for empty input", () => {
    expect(parseLsblkOutput("")).toEqual([])
    expect(parseLsblkOutput("   \n")).toEqual([])
  })
})

describe("parseSmartctlJson", () => {
  it("parses SATA drive correctly", () => {
    const result = parseSmartctlJson(SMARTCTL_SATA_JSON, "/dev/sda")
    expect(result.device).toBe("/dev/sda")
    expect(result.model).toBe("Samsung SSD 870 EVO 1TB")
    expect(result.serial).toBe("S123456789")
    expect(result.health).toBe("PASSED")
    expect(result.temperature).toBe(35)
    expect(result.powerOnHours).toBe(12345)
    expect(result.reallocatedSectors).toBe(0)
  })

  it("parses NVMe drive correctly", () => {
    const result = parseSmartctlJson(SMARTCTL_NVME_JSON, "/dev/nvme0n1")
    expect(result.device).toBe("/dev/nvme0n1")
    expect(result.model).toBe("Samsung 980 PRO 1TB")
    expect(result.serial).toBe("N987654321")
    expect(result.health).toBe("PASSED")
    expect(result.temperature).toBe(40)
    expect(result.powerOnHours).toBe(5678)
    // NVMe has no reallocated sectors via ata_smart_attributes
    expect(result.reallocatedSectors).toBeNull()
  })

  it("returns FAILED health when smart_status.passed is false", () => {
    const result = parseSmartctlJson(SMARTCTL_FAILED_JSON, "/dev/sdb")
    expect(result.health).toBe("FAILED")
    expect(result.reallocatedSectors).toBe(247)
  })

  it("handles missing optional fields as null", () => {
    const result = parseSmartctlJson(SMARTCTL_MISSING_FIELDS_JSON, "/dev/sdc")
    expect(result.health).toBe("PASSED")
    expect(result.temperature).toBeNull()
    expect(result.powerOnHours).toBeNull()
    expect(result.reallocatedSectors).toBeNull()
  })

  it("handles invalid JSON gracefully", () => {
    const result = parseSmartctlJson("not json at all", "/dev/sdd")
    expect(result.device).toBe("/dev/sdd")
    expect(result.health).toBe("FAILED")
    expect(result.temperature).toBeNull()
    expect(result.model).toBe("")
  })

  it("treats missing smart_status as FAILED", () => {
    const noStatus = JSON.stringify({ model_name: "Foo", serial_number: "Bar" })
    const result = parseSmartctlJson(noStatus, "/dev/sde")
    expect(result.health).toBe("FAILED")
  })
})
