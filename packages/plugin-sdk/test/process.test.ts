import { existsSync, readFileSync } from "node:fs"
import { Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { followProcessLines } from "../src/process.js"

/** `kill(pid, 0)` still succeeds for an unreaped zombie, so this proves reaping too. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const collectLines = (stream: Stream.Stream<{ readonly lines: ReadonlyArray<string> }, Error>) =>
  Effect.runPromise(
    Stream.runCollect(stream).pipe(
      Effect.map((batches) => Array.from(batches, (batch) => [...batch.lines])),
    ),
  )

describe("followProcessLines", () => {
  it("streams non-empty lines and ends with the child, keeping a trailing partial line", async () => {
    const batches = await collectLines(
      followProcessLines("sh", ["-c", "printf 'one\\n\\ntwo\\nthree'"]),
    )

    expect(batches.flat()).toEqual(["one", "two", "three"])
  })

  it("caps batches at maxBatchLines", async () => {
    const batches = await collectLines(
      followProcessLines("sh", ["-c", "printf 'a\\nb\\nc\\nd\\ne\\n'"], { maxBatchLines: 2 }),
    )

    expect(batches.flat()).toEqual(["a", "b", "c", "d", "e"])
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(2)
  })

  it("fails when the command cannot be started", async () => {
    const exit = await Effect.runPromiseExit(
      Stream.runDrain(followProcessLines("scout-no-such-command", [])),
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("kills and reaps a quiet follower once the consumer stops", async () => {
    const head = await Effect.runPromise(
      Stream.runHead(followProcessLines("sh", ["-c", "echo $$; exec sleep 600"])).pipe(
        Effect.timeout("5 seconds"),
      ),
    )

    expect(head._tag).toBe("Some")
    if (head._tag !== "Some") return
    expect(isRunning(Number(head.value.lines[0]))).toBe(false)
  })

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const started = Date.now()
    const head = await Effect.runPromise(
      Stream.runHead(
        // An ignored signal stays ignored across exec, so `sleep` ignores SIGTERM.
        followProcessLines("sh", ["-c", "trap '' TERM; echo $$; exec sleep 600"], {
          killTimeout: "200 millis",
        }),
      ).pipe(Effect.timeout("5 seconds")),
    )

    expect(head._tag).toBe("Some")
    if (head._tag !== "Some") return
    expect(isRunning(Number(head.value.lines[0]))).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(200)
  })

  it.skipIf(!existsSync("/proc/self/io"))(
    "pauses the child while the consumer is behind instead of buffering without limit",
    async () => {
      const bytesWritten = (pid: number): number => {
        const io = readFileSync(`/proc/${pid}/io`, "utf8")
        return Number(/^wchar: (\d+)$/m.exec(io)?.[1] ?? Number.NaN)
      }

      // awk writes as fast as the pipe drains; only backpressure stops it.
      // (`yes` is no good here: uutils `yes` splices, which wchar does not count.)
      const written = await Effect.runPromise(
        Stream.runHead(
          followProcessLines("sh", ["-c", "echo $$; exec awk 'BEGIN { while (1) print \"scout-backpressure\" }'"]).pipe(
            Stream.mapEffect((batch) =>
              Effect.sleep("500 millis").pipe(
                Effect.map(() => bytesWritten(Number(batch.lines[0]))),
              ),
            ),
          ),
        ).pipe(Effect.timeout("5 seconds")),
      )

      expect(written._tag).toBe("Some")
      if (written._tag !== "Some") return
      // A pipe buffer and one bounded queue (well under 1MB here), against
      // 10-20MB in 500ms when nothing pushes back.
      expect(written.value).toBeLessThan(3 * 1024 * 1024)
    },
  )
})
