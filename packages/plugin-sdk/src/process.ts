/**
 * Child-process streams for plugin agent runtimes.
 */

import { spawn, type ChildProcess } from "node:child_process"
import { Cause, Duration, Effect, Queue, Stream } from "effect"

export interface ProcessLineBatch {
  readonly lines: ReadonlyArray<string>
  readonly ts: number
}

export interface FollowProcessLinesOptions {
  /** Largest batch emitted at once. Defaults to 50 lines. */
  readonly maxBatchLines?: number
  /** Grace period between SIGTERM and SIGKILL on release. Defaults to 2 seconds. */
  readonly killTimeout?: Duration.Input
}

const hasExited = (proc: ChildProcess): boolean =>
  proc.exitCode !== null || proc.signalCode !== null

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
 * printed. The stream ends when the child exits.
 */
export const followProcessLines = (
  command: string,
  args: ReadonlyArray<string>,
  options: FollowProcessLinesOptions = {},
): Stream.Stream<ProcessLineBatch, Error> => {
  const maxBatchLines = options.maxBatchLines ?? 50
  const killTimeout = options.killTimeout ?? "2 seconds"

  return Stream.callback<ProcessLineBatch, Error>((queue) =>
    Effect.gen(function* () {
      const proc = yield* Effect.acquireRelease(
        Effect.try({
          try: () => spawn(command, [...args], { stdio: ["ignore", "pipe", "ignore"] }),
          catch: (error) => new Error(`Failed to spawn ${command}: ${String(error)}`),
        }),
        (child) => terminate(child, killTimeout),
      )

      const decoder = new TextDecoder()
      let buffer = ""

      const emit = (lines: Array<string>) => {
        for (let start = 0; start < lines.length; start += maxBatchLines) {
          Queue.offerUnsafe(queue, {
            lines: lines.slice(start, start + maxBatchLines),
            ts: Date.now(),
          })
        }
      }

      proc.stdout!.on("data", (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        emit(lines.filter((line) => line.length > 0))
      })
      proc.once("error", (error) => {
        Queue.failCauseUnsafe(queue, Cause.fail(new Error(`${command} failed: ${error.message}`)))
      })
      // "close" fires after stdout is drained, so the trailing partial line is
      // complete by then.
      proc.once("close", () => {
        buffer += decoder.decode()
        if (buffer.length > 0) emit([buffer])
        buffer = ""
        Queue.endUnsafe(queue)
      })
    }),
  )
}
