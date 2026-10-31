import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthManager } from '../auth.js'
import { normalizeTopK, toRemoteError } from '../errors.js'
import type {
  AuthStatus,
  DeviceAuthPoll,
  DeviceAuthStart,
  EventsConsent,
  PlaybackSession,
  SearchResult,
  Segment,
} from '../shared/contracts.js'
import {
  createPlaybackSession,
  getSegment,
  searchKnowledge,
} from './cloud-client.js'
import type { EventReporter } from './events.js'
import type { HostLogger } from './log.js'

export class TrendCoachService extends TypertRemoteService {
  private readonly auth: AuthManager
  private readonly logger: HostLogger
  private readonly events: EventReporter

  constructor(ctx: Context, auth: AuthManager, logger: HostLogger, events: EventReporter) {
    super(ctx, 'trendCoach')
    this.auth = auth
    this.logger = logger
    this.events = events
  }

  /** 失败只记录操作名与错误类型，不记录 token、设备 ID 或 query 原文。 */
  private async invoke<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      this.logger.warn('%s failed: %s', operation, error instanceof Error ? error.name : typeof error)
      throw toRemoteError(error, operation)
    }
  }

  @Remote
  async search(query: string, topK: number, signal: AbortSignal): Promise<SearchResult> {
    const startedAt = Date.now()
    const result = await this.invoke('知识库检索', () =>
      searchKnowledge(this.auth, query, topK, undefined, signal))
    this.events.reportSearch(Date.now() - startedAt, normalizeTopK(topK), result.segments.length)
    return result
  }

  @Remote
  async getSegment(segmentId: string, signal: AbortSignal): Promise<Segment> {
    return await this.invoke('片段查询', () => getSegment(this.auth, segmentId, signal))
  }

  @Remote
  async createPlaybackSession(segmentId: string, signal: AbortSignal): Promise<PlaybackSession> {
    return await this.invoke('播放会话创建', () =>
      createPlaybackSession(this.auth, segmentId, signal))
  }

  @Remote
  async authStatus(): Promise<AuthStatus> {
    return await this.invoke('授权状态读取', () => this.auth.status())
  }

  @Remote
  async beginDeviceAuth(signal: AbortSignal): Promise<DeviceAuthStart> {
    return await this.invoke('设备授权发起', () => this.auth.beginDeviceAuth(signal))
  }

  @Remote
  async pollDeviceAuth(signal: AbortSignal): Promise<DeviceAuthPoll> {
    return await this.invoke('设备授权轮询', () => this.auth.pollDeviceAuth(signal))
  }

  @Remote
  async eventConsent(): Promise<EventsConsent> {
    return await this.invoke('事件同意读取', () => this.events.getConsent())
  }

  @Remote
  async setEventConsent(consent: boolean): Promise<EventsConsent> {
    return await this.invoke('事件同意更新', () => this.events.setConsent(consent))
  }

  @Remote
  async reportCitationClick(segmentId: string): Promise<{ reported: true }> {
    this.events.reportCitationClick(segmentId)
    return { reported: true }
  }

  @Remote
  async reportPlayerStarted(startupMs: number, autoplayBlocked: boolean): Promise<{ reported: true }> {
    this.events.reportPlayerStarted(startupMs, autoplayBlocked)
    return { reported: true }
  }

  @Remote
  async signOut(): Promise<{ signedOut: true }> {
    await this.invoke('退出登录', () => this.auth.signOut())
    this.events.resetConsent()
    return { signedOut: true }
  }
}
