import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"

/**
 * The latest successful value of a HubClient query, kept through a failed
 * refresh (for example once the Access session expires), else `fallback`.
 */
export const lastValue = <A, E, B>(result: AsyncResult.AsyncResult<A, E>, fallback: B): A | B =>
  Option.getOrElse(AsyncResult.value(result), () => fallback)
