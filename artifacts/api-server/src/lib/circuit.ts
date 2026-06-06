/**
 * Resilience policies for outbound HTTP to flaky external dependencies.
 *
 * Each policy combines:
 *  - a circuit breaker (ConsecutiveBreaker): after `consecutiveFailures`
 *    failures the breaker OPENs and calls fail fast (BrokenCircuitError)
 *    instead of hanging/piling up; it half-opens after a cooldown to probe.
 *  - optional retry with exponential backoff for IDEMPOTENT calls only.
 *
 * IMPORTANT: retries default to 2 but MUST be 0 for non-idempotent side
 * effects (SMS send, Telegram sendMessage, payment transactions) — retrying
 * those risks duplicate charges/messages. Callers opt out via { retries: 0 }.
 *
 * The breaker is OUTER and retry INNER (wrap(breaker, retry)): when the breaker
 * is open it fails fast with no retry/backoff latency, and a fully-exhausted
 * retry sequence counts as a single breaker failure.
 *
 * All breakers register themselves so health checks can report their live state
 * (see getBreakerStates / getExternalHealth).
 */
import {
  circuitBreaker,
  retry,
  wrap,
  handleAll,
  ConsecutiveBreaker,
  ExponentialBackoff,
  CircuitState,
  type IPolicy,
  type CircuitBreakerPolicy,
} from "cockatiel";
import { clog } from "./logger.js";

const registry = new Map<string, CircuitBreakerPolicy>();

export interface BreakerOptions {
  /** Failures in a row before the circuit opens. */
  consecutiveFailures?: number;
  /** Cooldown before a half-open probe. */
  halfOpenAfterMs?: number;
  /** Retry attempts for idempotent calls. MUST be 0 for non-idempotent sends. */
  retries?: number;
}

export function makeBreaker(name: string, opts: BreakerOptions = {}): IPolicy {
  const { consecutiveFailures = 5, halfOpenAfterMs = 15_000, retries = 2 } = opts;

  const breaker = circuitBreaker(handleAll, {
    halfOpenAfter: halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(consecutiveFailures),
  });
  breaker.onBreak(() => clog.warn(`[CIRCUIT] ${name} OPEN — failing fast for ~${halfOpenAfterMs}ms`));
  breaker.onHalfOpen(() => clog.log(`[CIRCUIT] ${name} half-open — probing`));
  breaker.onReset(() => clog.log(`[CIRCUIT] ${name} CLOSED — recovered`));
  registry.set(name, breaker);

  if (retries <= 0) return breaker;

  const retryPolicy = retry(handleAll, {
    maxAttempts: retries,
    backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2_000 }),
  });
  // breaker outer, retry inner
  return wrap(breaker, retryPolicy);
}

/** name → human-readable circuit state ("Closed" | "Open" | "HalfOpen" | "Isolated"). */
export function getBreakerStates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, b] of registry) {
    out[name] = CircuitState[b.state] ?? String(b.state);
  }
  return out;
}

/**
 * Health view of every external dependency guarded by a breaker. A closed
 * circuit is "ok"; half-open is "degraded" (probing); open is "down" (failing
 * fast). Cheap — reflects the outcome of recent real calls, makes no network
 * request of its own.
 */
export function getExternalHealth(): { ok: boolean; services: Record<string, { status: string; circuit: string }> } {
  const services: Record<string, { status: string; circuit: string }> = {};
  let ok = true;
  for (const [name, b] of registry) {
    const circuit = CircuitState[b.state] ?? String(b.state);
    const status = b.state === CircuitState.Closed ? "ok" : b.state === CircuitState.HalfOpen ? "degraded" : "down";
    if (status === "down") ok = false;
    services[name] = { status, circuit };
  }
  return { ok, services };
}
