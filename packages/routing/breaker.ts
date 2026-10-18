/**
 * Failover settings and a circuit breaker per provider, ported from cc-switch's `circuit_breaker.rs` and its per-app
 * defaults (MIT). Claude Code gets more patience than Codex: its turns are longer and it retries less on its own.
 */

export type Client = 'codex' | 'claude'

export interface FailoverPolicy {
  /** Retries after a failure; at most this many + 1 providers are tried for one request. */
  maxRetries: number
  /** Seconds to wait for a streaming response's first byte before trying the next provider. */
  firstByteTimeout: number
  /** Seconds a stream may stay silent once it has started. */
  idleTimeout: number
  /** Seconds a non-streaming request may take. */
  requestTimeout: number
  /** Consecutive failures that open the breaker. */
  failureThreshold: number
  /** Successful probes that close it again. */
  successThreshold: number
  /** Seconds an open breaker waits before letting one probe through. */
  openSeconds: number
  /** Error rate that opens the breaker, once `minRequests` requests were counted. */
  errorRate: number
  minRequests: number
}

export const failoverDefaults: Record<Client, FailoverPolicy> = {
  claude: { maxRetries: 6, firstByteTimeout: 90, idleTimeout: 180, requestTimeout: 600, failureThreshold: 8, successThreshold: 3, openSeconds: 90, errorRate: 0.7, minRequests: 15 },
  codex: { maxRetries: 3, firstByteTimeout: 60, idleTimeout: 120, requestTimeout: 600, failureThreshold: 4, successThreshold: 2, openSeconds: 60, errorRate: 0.6, minRequests: 10 },
}

export type BreakerState = 'closed' | 'open' | 'half_open'
export interface BreakerStats { state: BreakerState, consecutiveFailures: number, total: number, failed: number, openedAt?: number }

/**
 * Closed lets everything through; enough failures (in a row, or as a rate) open it; after `openSeconds` one probe at a
 * time goes through (half-open), and `successThreshold` successes close it, one failure opens it again.
 */
export class CircuitBreaker {
  private state: BreakerState = 'closed'
  private consecutiveFailures = 0
  private consecutiveSuccesses = 0
  private total = 0
  private failed = 0
  private openedAt?: number
  private probes = 0

  constructor(private policy: () => FailoverPolicy, private now: () => number = Date.now) {}

  private maybeHalfOpen() {
    if (this.state === 'open' && this.openedAt !== undefined && this.now() - this.openedAt >= this.policy().openSeconds * 1000) {
      this.state = 'half_open'
      this.consecutiveSuccesses = 0
      this.probes = 0
    }
  }

  /** Worth putting in the line-up (no probe taken). */
  available() {
    this.maybeHalfOpen()
    return this.state !== 'open'
  }

  /** Take a slot for a request: always when closed, one probe at a time when half-open. */
  allow(): { allowed: boolean, probe: boolean } {
    this.maybeHalfOpen()
    if (this.state === 'closed')
      return { allowed: true, probe: false }
    if (this.state === 'open' || this.probes >= 1)
      return { allowed: false, probe: false }
    this.probes++
    return { allowed: true, probe: true }
  }

  success(probe: boolean) {
    if (probe)
      this.release()
    this.consecutiveFailures = 0
    this.total++
    if (this.state === 'half_open' && ++this.consecutiveSuccesses >= this.policy().successThreshold)
      this.close()
  }

  failure(probe: boolean) {
    if (probe)
      this.release()
    const failures = ++this.consecutiveFailures
    this.total++
    this.failed++
    this.consecutiveSuccesses = 0
    const policy = this.policy()
    if (this.state === 'half_open')
      return this.open()
    if (this.state === 'closed' && (failures >= policy.failureThreshold || (this.total >= policy.minRequests && this.failed / this.total >= policy.errorRate)))
      this.open()
  }

  /** A result that says nothing about the provider's health (the request itself was bad, or the agent left). */
  neutral(probe: boolean) {
    if (probe)
      this.release()
  }

  reset() { this.close() }

  stats(): BreakerStats {
    this.maybeHalfOpen()
    return { state: this.state, consecutiveFailures: this.consecutiveFailures, total: this.total, failed: this.failed, ...(this.state === 'open' ? { openedAt: this.openedAt } : {}) }
  }

  private release() { this.probes = Math.max(0, this.probes - 1) }

  private open() {
    this.state = 'open'
    this.openedAt = this.now()
    this.consecutiveFailures = 0
    this.consecutiveSuccesses = 0
  }

  private close() {
    this.state = 'closed'
    this.consecutiveFailures = 0
    this.consecutiveSuccesses = 0
    this.total = 0
    this.failed = 0
    this.openedAt = undefined
  }
}

/**
 * Whether a provider's HTTP status is worth trying the next provider for. A malformed request is refused everywhere,
 * so retrying it only burns quota and health; anything else (auth, quota, rate limits, outages) may differ next door.
 */
export const retryableStatus = (status: number) => ![400, 405, 406, 413, 414, 415, 422, 501].includes(status)
