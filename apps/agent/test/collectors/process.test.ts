import { describe, expect, it } from "vitest"
import { parsePsOutput } from "../../src/collectors/process.js"

// ---------------------------------------------------------------------------
// Sample ps aux output
// ---------------------------------------------------------------------------

const PS_AUX_OUTPUT = `USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.1 168016 11540 ?        Ss   Jan01   0:04 /sbin/init
root           2  0.0  0.0      0     0 ?        S    Jan01   0:00 [kthreadd]
systemd+     123  0.5  0.3  89504 28672 ?        Ssl  Jan01   1:15 /lib/systemd/systemd-resolved
www-data     456  2.3  1.2 456789 98304 ?        S    Jan01   5:30 /usr/sbin/nginx
postgres     789  5.1  3.4 987654 278528 ?       Ss   Jan01  12:00 /usr/lib/postgresql/14/bin/postgres
root        1001  0.0  0.0  12345   1024 pts/0   S+   10:00   0:00 bash
user1       2001 15.2  4.5 234567 368640 ?       Rl   10:01   2:30 /usr/bin/python3 myapp.py
root        3001  0.0  0.1  67890  8192 ?        Ss   Jan01   0:01 /usr/sbin/sshd
`

describe("parsePsOutput", () => {
  it("parses all data rows (skips header)", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    expect(result).toHaveLength(8)
  })

  it("parses pid correctly", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const pids = result.map((p) => p.pid)
    expect(pids).toContain(1)
    expect(pids).toContain(456)
    expect(pids).toContain(2001)
  })

  it("parses user correctly", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const nginx = result.find((p) => p.pid === 456)
    expect(nginx?.user).toBe("www-data")
  })

  it("parses cpuPercent correctly", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const python = result.find((p) => p.pid === 2001)
    expect(python?.cpuPercent).toBe(15.2)
  })

  it("parses memPercent correctly", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const postgres = result.find((p) => p.pid === 789)
    expect(postgres?.memPercent).toBe(3.4)
  })

  it("converts RSS kB to bytes", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    // nginx: RSS = 98304 kB → 98304 * 1024 bytes
    const nginx = result.find((p) => p.pid === 456)
    expect(nginx?.memBytes).toBe(98304 * 1024)
  })

  it("parses command name (first token)", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const nginx = result.find((p) => p.pid === 456)
    expect(nginx?.name).toBe("/usr/sbin/nginx")
  })

  it("handles kernel threads (RSS = 0)", () => {
    const result = parsePsOutput(PS_AUX_OUTPUT)
    const kthread = result.find((p) => p.pid === 2)
    expect(kthread).toBeDefined()
    expect(kthread?.memBytes).toBe(0)
  })

  it("returns empty array for header-only or empty input", () => {
    expect(parsePsOutput("USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n")).toHaveLength(0)
    expect(parsePsOutput("")).toHaveLength(0)
  })

  it("top 20 by CPU: result is sorted desc by cpuPercent after slice", () => {
    // Build a large output and verify slice(0, 20) ordering
    let header = "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n"
    let rows = ""
    for (let i = 1; i <= 25; i++) {
      const cpu = 25 - i // descending order
      rows += `user1       ${1000 + i}  ${cpu}.0  1.0  10000  1024 ?  S  Jan01  0:00 /usr/bin/proc${i}\n`
    }
    const parsed = parsePsOutput(header + rows)
    // Already in the order they were fed (ps --sort=-pcpu handles sorting)
    const top20 = parsed.slice(0, 20)
    expect(top20).toHaveLength(20)
    // First should have highest cpu (24.0)
    expect(top20[0]?.cpuPercent).toBe(24.0)
  })
})
