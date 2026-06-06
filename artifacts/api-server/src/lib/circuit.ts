/**
 * Circuit breakers for outbound HTTP to flaky external dependencies.
 * After `consecutiveFailures` failures the breaker OPENs and calls fail fast
 * (BrokenCircuitError) instead of hanging/piling up; it half-opens after a
 * cooldown to probe recovery. Callers catch the error and return their normal
 * fallback (null / {success:false} / error response).
 */
import { circuitBreaker, handleAll, ConsecutiveBreaker, type CircuitBreakerPolicy } from "cockatiel";
import { clog } from "./logger.js";

export function makeBreaker(
  name: string,
  consecutiveFailures = 5,
  halfOpenAfterMs = 15_000,
): CircuitBreakerPolicy {
  const b = circuitBreaker(handleAll, {
    halfOpenAfter: halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(consecutiveFailures),
  });
  b.onBreak(() => clog.warn(`[CIRCUIT] ${name} OPEN — failing fast for ~${halfOpenAfterMs}ms`));
  b.onHalfOpen(() => clog.log(`[CIRCUIT] ${name} half-open — probing`));
  b.onReset(() => clog.log(`[CIRCUIT] ${name} CLOSED — recovered`));
  return b;
}
