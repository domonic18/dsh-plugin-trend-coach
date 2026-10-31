import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthManager } from '../auth.js'
import { toRemoteError } from '../errors.js'
import type {
  AuthStatus,
  DeviceAuthPoll,
  DeviceAuthStart,
  PlaybackSession,
  SearchResult,
  Segment,
} from '../shared/contracts.js'
import {
  createPlaybackSession,
  getSegment,
  searchKnowledge,
} from './cloud-client.js'
import type { HostLogger } from './log.js'

export class TrendCoachService extends TypertRemoteService {
  private readonly auth: AuthManager
  private readonly logger: HostLogger

  constructor(ctx: Context, auth: AuthManager, logger: HostLogger) {
    super(ctx, 'trendCoach')
    this.auth = auth
    this.logger = logger
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
    return await this.invoke('知识库检索', () =>
      searchKnowledge(this.auth, query, topK, undefined, signal))
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
  async signOut(): Promise<{ signedOut: true }> {
    await this.invoke('退出登录', () => this.auth.signOut())
    return { signedOut: true }
  }
}
