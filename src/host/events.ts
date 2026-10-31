import { randomUUID } from 'node:crypto'
import type { AuthManager } from '../auth.js'
import { isSegmentId, readJsonResponse } from '../errors.js'
import type { EventsConsent } from '../shared/contracts.js'
import type { HostLogger } from './log.js'

const CONSENT_PATH = '/v1/events/consent'
const EVENTS_PATH = '/v1/events'
// 上报本身是尽力而为：不持有 AbortController，超时由 AuthManager 统一控制。
const NO_SIGNAL = new AbortController().signal
const MAX_DURATION_MS = 60_000
const MAX_HITS = 20

type EventName = 'search_requested' | 'citation_clicked' | 'player_started'

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export class EventReporter {
  private consent: boolean | undefined
  private consentInFlight: Promise<boolean> | undefined

  constructor(
    private readonly auth: AuthManager,
    private readonly logger: HostLogger,
  ) {}

  async getConsent(): Promise<EventsConsent> {
    const response = await this.auth.request(CONSENT_PATH, {}, NO_SIGNAL)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`事件同意读取失败（HTTP ${response.status}）`)
    }
    return { consent: await this.readConsent(response) }
  }

  async setConsent(consent: boolean): Promise<EventsConsent> {
    const response = await this.auth.request(CONSENT_PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consent }),
    }, NO_SIGNAL)
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`事件同意更新失败（HTTP ${response.status}）`)
    }
    return { consent: await this.readConsent(response) }
  }

  resetConsent(): void {
    this.consent = undefined
  }

  reportSearch(durationMs: number, topK: number, hits: number): void {
    this.report('search_requested', {
      durationMs: clamp(durationMs, 0, MAX_DURATION_MS),
      topK: clamp(topK, 1, MAX_HITS),
      hits: clamp(hits, 0, MAX_HITS),
      empty: hits === 0,
    })
  }

  reportCitationClick(segmentId: string): void {
    if (!isSegmentId(segmentId)) return
    this.report('citation_clicked', { segmentId })
  }

  reportPlayerStarted(startupMs: number, autoplayBlocked: boolean): void {
    this.report('player_started', {
      startupMs: clamp(startupMs, 0, MAX_DURATION_MS),
      autoplayBlocked: autoplayBlocked === true,
    })
  }

  private async readConsent(response: Response): Promise<boolean> {
    const payload = await readJsonResponse(response)
    if (typeof payload !== 'object' || payload === null
      || typeof (payload as { consent?: unknown }).consent !== 'boolean') {
      throw new Error('事件同意响应不合法')
    }
    this.consent = (payload as EventsConsent).consent
    return this.consent
  }

  private report(name: EventName, props: Record<string, unknown>): void {
    void this.deliver(name, props)
  }

  /** 未同意或上报失败都只影响指标，不影响检索/播放主流程。 */
  private async deliver(name: EventName, props: Record<string, unknown>): Promise<void> {
    try {
      if (!(await this.consented())) return
      const response = await this.auth.request(EVENTS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: randomUUID(), name, occurredAt: Date.now(), props }),
      }, NO_SIGNAL)
      await response.body?.cancel()
      if (!response.ok) this.logger.debug('事件上报被拒绝: %s HTTP %d', name, response.status)
    } catch (error) {
      this.logger.debug('事件上报失败: %s', error instanceof Error ? error.name : typeof error)
    }
  }

  private async consented(): Promise<boolean> {
    if (this.consent !== undefined) return this.consent
    if (this.consentInFlight === undefined) {
      this.consentInFlight = this.fetchConsent().finally(() => {
        this.consentInFlight = undefined
      })
    }
    return await this.consentInFlight
  }

  private async fetchConsent(): Promise<boolean> {
    try {
      return (await this.getConsent()).consent
    } catch (error) {
      this.logger.debug('事件同意读取失败: %s', error instanceof Error ? error.name : typeof error)
      return false
    }
  }
}
