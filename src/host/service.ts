import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { AuthManager } from '../auth.js'
import { normalizeTopK, requireSessionId, toRemoteError } from '../errors.js'
import type {
  AuthStatus,
  CatalogChapterArticle,
  CatalogCourse,
  CatalogCourseSummary,
  DeviceAuthPoll,
  DeviceAuthStart,
  EventsConsent,
  KnowledgePointDetail,
  LearnerContextAck,
  LearnerContextUpdate,
  PlaybackSession,
  ProgressResult,
  SearchResult,
  Segment,
  VoiceTranscript,
} from '../shared/contracts.js'
import {
  createPlaybackSession,
  getCatalogChapter,
  getCatalogCourse,
  getKnowledgePoint,
  getSegment,
  listCourses,
  reportProgress as putProgress,
  searchKnowledge,
  transcribeVoice,
} from './cloud-client.js'
import type { EventReporter } from './events.js'
import { parseLearnerContextUpdate, type LearnerContextStore } from './learner-context.js'
import type { HostLogger } from './log.js'

export class TrendCoachService extends TypertRemoteService {
  private readonly auth: AuthManager
  private readonly logger: HostLogger
  private readonly events: EventReporter
  private readonly learnerContext: LearnerContextStore

  constructor(
    ctx: Context,
    auth: AuthManager,
    logger: HostLogger,
    events: EventReporter,
    learnerContext: LearnerContextStore,
    private readonly voiceTimeoutMs: number,
  ) {
    super(ctx, 'trendCoach')
    this.auth = auth
    this.logger = logger
    this.events = events
    this.learnerContext = learnerContext
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
  async catalogCourses(signal: AbortSignal): Promise<{ courses: CatalogCourseSummary[] }> {
    return await this.invoke('课程列表读取', () => listCourses(this.auth, signal))
  }

  @Remote
  async catalogCourse(courseId: string, signal: AbortSignal): Promise<CatalogCourse> {
    return await this.invoke('课程结构读取', () => getCatalogCourse(this.auth, courseId, signal))
  }

  @Remote
  async catalogChapter(
    courseId: string,
    chapterId: string,
    signal: AbortSignal,
  ): Promise<CatalogChapterArticle> {
    return await this.invoke('章节教材读取', () =>
      getCatalogChapter(this.auth, courseId, chapterId, signal))
  }

  @Remote
  async knowledgePoint(knowledgePointId: string, signal: AbortSignal): Promise<KnowledgePointDetail> {
    return await this.invoke('知识点读取', () =>
      getKnowledgePoint(this.auth, knowledgePointId, signal))
  }

  /** 进度是业务写入，失败只记 debug，不阻塞播放。 */
  @Remote
  async reportProgress(
    knowledgePointId: string,
    watchedSec: number,
    completed: boolean,
    signal: AbortSignal,
  ): Promise<ProgressResult> {
    try {
      return await putProgress(this.auth, knowledgePointId, watchedSec, completed, signal)
    } catch (error) {
      this.logger.debug('学习进度上报失败: %s', error instanceof Error ? error.name : typeof error)
      throw toRemoteError(error, '学习进度上报')
    }
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

  /** 纯本机内存：失败日志只记操作名与错误类型，不记录 sessionId、标题或选中文本。 */
  @Remote
  async setLearnerContext(sessionId: string, update: LearnerContextUpdate): Promise<LearnerContextAck> {
    return await this.invoke('学习上下文更新', () => {
      const id = requireSessionId(sessionId)
      return Promise.resolve(this.learnerContext.set(id, parseLearnerContextUpdate(update)))
    })
  }

  /** 音频与转写正文不落日志：invoke 只记录操作名与错误类型。 */
  @Remote
  async transcribeVoice(
    audioBase64: string,
    durationMs: number,
    signal: AbortSignal,
  ): Promise<VoiceTranscript> {
    const startedAt = Date.now()
    const result = await this.invoke('语音转写', () =>
      transcribeVoice(this.auth, audioBase64, durationMs, signal, this.voiceTimeoutMs))
    this.logger.debug('语音转写完成: %dms', Date.now() - startedAt)
    return result
  }

  @Remote
  async signOut(): Promise<{ signedOut: true }> {
    await this.invoke('退出登录', () => this.auth.signOut())
    this.events.resetConsent()
    this.learnerContext.clear()
    return { signedOut: true }
  }
}
