/**
 * Child-process streams for plugin agent runtimes.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { Cause, Duration, Effect, Fiber, Queue, Stream } from "effect"

export interface ProcessLineBatch {
  readonly lines: ReadonlyArray<string>
  readonly ts: number
}

export interface FollowProcessLinesOptions {
  /** Largest batch emitted at once. Defaults to 50 lines. */
  readonly maxBatchLines?: number
  /** Grace period between SIGTERM and SIGKILL on release. Defaults to 2 seconds. */
  readonly killTimeout?: Duration.Input
  /** Batches buffered ahead of the consumer before stdout pauses. Defaults to 16. */
  readonly bufferBatches?: number
}

const hasExited = (proc: ChildProcess): boolean => proc.exitCode !== null || proc.signalCode !== null

const awaitExit = (proc: ChildProcess): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    if (hasExited(proc)) return resume(Effect.void)
    const onExit = () => resume(Effect.void)
    proc.once("exit", onExit)
    return Effect.sync(() => proc.off("exit", onExit))
  })

/**
 * Stop the child and wait until it has exited, so it is reaped before the
 * stream's scope finishes closing. A child that ignores SIGTERM gets SIGKILL
 * after `killTimeout`.
 */
const terminate = (proc: ChildProcess, killTimeout: Duration.Input): Effect.Effect<void> =>
  Effect.suspend(() => {
    // A child that never started (`spawn` emitted "error") has no pid to signal.
    if (proc.pid === undefined || hasExited(proc)) return Effect.void
    proc.kill("SIGTERM")
    return awaitExit(proc).pipe(
      Effect.timeoutOrElse({
        duration: killTimeout,
        orElse: () =>
          Effect.suspend(() => {
            if (!hasExited(proc)) proc.kill("SIGKILL")
            return awaitExit(proc)
          }),
      }),
    )
  })

/**
 * Run `command` and stream its stdout as batches of non-empty lines.
 *
 * The child lives exactly as long as the stream: when the consumer stops
 * pulling (completion, failure, or interruption from an RPC cancel or a
 * dropped connection), the child is killed and reaped. Lines are flushed at
 * the end of every stdout chunk, so a quiet follower still delivers what it
 * printed. A slow consumer applies backpressure: stdout pauses while the
 * buffer is full, so the child blocks on its pipe instead of the agent
 * buffering without limit. The stream ends when the child exits.
 */
export const followProcessLines = (
  command: string,
  args: ReadonlyArray<string>,
  options: FollowProcessLinesOptions = {},
): Stream.Stream<ProcessLineBatch, Error> => {
  const maxBatchLines = options.maxBatchLines ?? 50
  const killTimeout = options.killTimeout ?? "2 seconds"
  const bufferBatches = options.bufferBatches ?? 16

  return Stream.callback<ProcessLineBatch, Error>(
    (queue) =>
      Effect.gen(function* () {
        const proc = yield* Effect.acquireRelease(
          Effect.try({
            try: () => spawn(command, [...args], { stdio: ["ignore", "pipe", "ignore"] }),
            catch: (error) => new Error(`Failed to spawn ${command}: ${String(error)}`),
          }),
          (child) => terminate(child, killTimeout),
        )

        const stdout = proc.stdout!
        const decoder = new TextDecoder()
        let buffer = ""
        let pendingOffer: Fiber.Fiber<unknown> | undefined

        const toBatches = (lines: Array<string>): Array<ProcessLineBatch> => {
          const batches: Array<ProcessLineBatch> = []
          for (let start = 0; start < lines.length; start += maxBatchLines) {
            batches.push({ lines: lines.slice(start, start + maxBatchLines), ts: Date.now() })
          }
          return batches
        }

        stdout.on("data", (chunk: Buffer) => {
          buffer += decoder.decode(chunk, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          const batches = toBatches(lines.filter((line) => line.length > 0))
          if (batches.length === 0) return
          // Hold further chunks until the consumer has room, which also keeps
          // batches in order: only one offer is ever outstanding.
          stdout.pause()
          pendingOffer = Effect.runFork(
            Queue.offerAll(queue, batches).pipe(Effect.ensuring(Effect.sync(() => stdout.resume()))),
          )
        })
        proc.once("error", (error) => {
          Queue.failCauseUnsafe(queue, Cause.fail(new Error(`${command} failed: ${error.message}`)))
        })
        // "close" fires once stdout has ended, so the trailing partial line is
        // complete. The queue ends only after the last chunk's offer lands.
        proc.once("close", () => {
          buffer += decoder.decode()
          const tail = buffer.length > 0 ? toBatches([buffer]) : []
          buffer = ""
          const previous = pendingOffer
          Effect.runFork(
            (previous === undefined ? Effect.void : Fiber.await(previous)).pipe(
              Effect.andThen(Queue.offerAll(queue, tail)),
              Effect.andThen(Queue.end(queue)),
            ),
          )
        })
      }),
    { bufferSize: bufferBatches },
  )
}
