import type { Context, Logger, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  AuthManager,
  type AuthStatus,
  type DeviceAuthPoll,
  type DeviceAuthStart,
} from './auth.js'
import {
  InvalidResponseError,
  UpstreamError,
  isSegmentId,
  normalizeTopK,
  optionalCourseId,
  readJsonResponse,
  requireQuery,
  requireSegmentId,
  toRemoteError,
  toToolError,
} from './errors.js'

export const name = 'trend-coach'

export const inject = ['tools', 'credentials']

export interface Config {
  baseUrl: string
  apiTokenRef: Volatile<string>
  timeoutMs: number
}

export const Config = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:3939'),
  apiTokenRef: Schema.string().role('credential-ref').default('TREND_COACH_API_TOKEN').volatile(),
  timeoutMs: Schema.number().default(10000),
})

interface Segment {
  segmentId: string
  courseId: string
  chapterId: string
  knowledgePointId: string
  title: string
  courseTitle?: string
  chapterTitle?: string
  knowledgePointTitle?: string
  startSec: number
  endSec: number
  text: string
  score: number
}

interface RelatedKnowledgePoint {
  knowledgePointId: string
  title: string
}

interface SearchResult {
  query: string
  segments: Segment[]
  relatedKnowledgePoints: RelatedKnowledgePoint[]
}

interface PlaybackSession {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark?: { label: string }
}

const MAX_SEGMENT_TEXT = 4000
const MAX_RELATED_POINTS = 5
const MAX_TITLE_LENGTH = 200

const outputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', required: true },
    segments: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          segmentId: { type: 'string', required: true },
          courseId: { type: 'string', required: true },
          chapterId: { type: 'string', required: true },
          knowledgePointId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          courseTitle: { type: 'string' },
          chapterTitle: { type: 'string' },
          knowledgePointTitle: { type: 'string' },
          startSec: { type: 'number', required: true },
          endSec: { type: 'number', required: true },
          text: { type: 'string', required: true },
          score: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
    },
    relatedKnowledgePoints: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        properties: {
          knowledgePointId: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const

function renderResult(_args: unknown, value: SearchResult): Array<{ type: 'text'; text: string }> {
  if (value.segments.length === 0) {
    if (value.relatedKnowledgePoints.length === 0) {
      return [{ type: 'text', text: '课程未覆盖该问题:知识库没有召回相关片段。' }]
    }
    const lines = [
      '课程未覆盖该问题:知识库没有召回相关片段。',
      '以下是可能相关的知识点标题,只作学习方向提示,不包含视频时间点,不得当作引用:',
      ...value.relatedKnowledgePoints.map((point) => `- ${point.title} (${point.knowledgePointId})`),
    ]
    return [{ type: 'text', text: lines.join('\n') }]
  }

  const lines = [`检索到 ${value.segments.length} 个课程片段:`, '']
  for (const segment of value.segments) {
    lines.push(
      `[${segment.segmentId}] ${segment.title}`,
      `课程 ${segment.courseTitle ?? segment.courseId} / 章节 ${segment.chapterTitle ?? segment.chapterId} / 知识点 ${segment.knowledgePointTitle ?? segment.knowledgePointId}`,
      `视频位置 ${segment.startSec}s - ${segment.endSec}s (相关度 ${segment.score.toFixed(3)})`,
      `引用链接(原样整段复制到回答里,不要改写):[${segment.title}](${citationUrl(segment)})`,
      segment.text,
      '',
    )
  }
  lines.push('回答时请直接复制每个片段给出的引用链接(形如 [标题](https://trend-coach.local/segment/...)),不得自行生成时间点或链接。')
  return [{ type: 'text', text: lines.join('\n') }]
}

function citationUrl(segment: Segment): string {
  return `https://trend-coach.local/segment/${encodeURIComponent(segment.segmentId)}?t=${segment.startSec}&e=${segment.endSec}`
}

function isRelatedKnowledgePoint(value: unknown): value is RelatedKnowledgePoint {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.knowledgePointId === 'string' &&
    candidate.knowledgePointId.length > 0 &&
    candidate.knowledgePointId.length <= 64 &&
    typeof candidate.title === 'string' &&
    candidate.title.length > 0 &&
    candidate.title.length <= MAX_TITLE_LENGTH
  )
}

function isOptionalTitle(value: unknown): boolean {
  return value === undefined
    || (typeof value === 'string' && value.length > 0 && value.length <= MAX_TITLE_LENGTH)
}

function isSegment(value: unknown): value is Segment {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isSegmentId(candidate.segmentId) &&
    typeof candidate.courseId === 'string' && candidate.courseId.length > 0 &&
    typeof candidate.chapterId === 'string' && candidate.chapterId.length > 0 &&
    typeof candidate.knowledgePointId === 'string' && candidate.knowledgePointId.length > 0 &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.startSec === 'number' && Number.isFinite(candidate.startSec) && candidate.startSec >= 0 &&
    typeof candidate.endSec === 'number' && Number.isFinite(candidate.endSec) && candidate.endSec >= candidate.startSec &&
    typeof candidate.text === 'string' && candidate.text.length <= MAX_SEGMENT_TEXT &&
    typeof candidate.score === 'number' && Number.isFinite(candidate.score)
      && candidate.score >= 0 && candidate.score <= 1 &&
    isOptionalTitle(candidate.courseTitle) &&
    isOptionalTitle(candidate.chapterTitle) &&
    isOptionalTitle(candidate.knowledgePointTitle)
  )
}

async function searchKnowledge(
  auth: AuthManager,
  config: Config,
  query: string,
  topK: number,
  courseId: string | undefined,
  signal: AbortSignal,
): Promise<SearchResult> {
  const normalizedQuery = requireQuery(query)
  const normalizedTopK = normalizeTopK(topK)
  const normalizedCourseId = optionalCourseId(courseId)

  const body: Record<string, unknown> = { query: normalizedQuery, topK: normalizedTopK }
  if (normalizedCourseId !== undefined) body.courseId = normalizedCourseId

  const response = await auth.request('/v1/kb/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, signal)

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('课程服务返回了非对象响应')
  }

  const rawSegments = (payload as { segments?: unknown }).segments
  if (!Array.isArray(rawSegments)) {
    throw new InvalidResponseError('课程服务响应缺少片段列表')
  }

  const segments = rawSegments.filter(isSegment)
  if (segments.length !== rawSegments.length) {
    throw new InvalidResponseError('课程服务响应包含不合法的片段')
  }

  const rawRelated = (payload as { relatedKnowledgePoints?: unknown }).relatedKnowledgePoints
  let relatedKnowledgePoints: RelatedKnowledgePoint[] = []
  if (rawRelated !== undefined) {
    if (!Array.isArray(rawRelated) || rawRelated.length > MAX_RELATED_POINTS
      || !rawRelated.every(isRelatedKnowledgePoint)) {
      throw new InvalidResponseError('课程服务响应包含不合法的相关知识点')
    }
    relatedKnowledgePoints = rawRelated
  }

  return { query: normalizedQuery, segments, relatedKnowledgePoints }
}

async function getSegment(
  auth: AuthManager,
  config: Config,
  segmentId: string,
  signal: AbortSignal,
): Promise<Segment> {
  const normalizedSegmentId = requireSegmentId(segmentId)
  const response = await auth.request(
    `/v1/kb/segments/${encodeURIComponent(normalizedSegmentId)}`,
    {},
    signal,
  )

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isSegment(payload) || payload.segmentId !== normalizedSegmentId) {
    throw new InvalidResponseError('课程服务返回的片段信息不合法')
  }
  return payload
}

function isPlaybackSession(value: unknown): value is PlaybackSession {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const watermark = candidate.watermark
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) return false
  if (typeof candidate.playlistUrl !== 'string') return false
  try {
    const url = new URL(candidate.playlistUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  } catch {
    return false
  }
  if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return false
  return watermark === undefined ||
    (typeof watermark === 'object' && watermark !== null
      && typeof (watermark as Record<string, unknown>).label === 'string')
}

async function createPlaybackSession(
  auth: AuthManager,
  config: Config,
  segmentId: string,
  signal: AbortSignal,
): Promise<PlaybackSession> {
  const normalizedSegmentId = requireSegmentId(segmentId)
  const response = await auth.request('/v1/playback/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segmentId: normalizedSegmentId }),
  }, signal)

  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isPlaybackSession(payload)) {
    throw new InvalidResponseError('课程服务返回的播放会话不合法')
  }
  return payload
}

class TrendCoachService extends TypertRemoteService {
  private readonly config: Config
  private readonly auth: AuthManager
  private readonly logger: Logger

  constructor(ctx: Context, config: Config, auth: AuthManager) {
    super(ctx, 'trendCoach')
    this.config = config
    this.auth = auth
    this.logger = ctx.logger('trend-coach')
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
      searchKnowledge(this.auth, this.config, query, topK, undefined, signal))
  }

  @Remote
  async getSegment(segmentId: string, signal: AbortSignal): Promise<Segment> {
    return await this.invoke('片段查询', () =>
      getSegment(this.auth, this.config, segmentId, signal))
  }

  @Remote
  async createPlaybackSession(segmentId: string, signal: AbortSignal): Promise<PlaybackSession> {
    return await this.invoke('播放会话创建', () =>
      createPlaybackSession(this.auth, this.config, segmentId, signal))
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

export function apply(ctx: Context, config: Config): void {
  const auth = new AuthManager(ctx, config)
  new TrendCoachService(ctx, config, auth)

  ctx.tools.register(
    defineTool({
      name: 'trend_coach_search',
      description:
        '检索趋势交易课程知识库。回答任何与趋势交易课程内容相关的问题前必须先调用此工具。'
        + '返回的每个片段带唯一 segmentId 与视频起止秒;回答只能引用返回的 segmentId,不得自行编造时间点。'
        + '没有召回结果时,明确告诉学员课程未覆盖该问题;若返回 relatedKnowledgePoints,只能提示学习方向,不得当作引用或补造时间点。',
      parameters: {
        query: { type: 'string', required: true, description: '学员问题的检索语句' },
        courseId: { type: 'string', description: '可选:限定课程 ID' },
        topK: { type: 'number', description: '可选:返回片段数,默认 5' },
      },
      output: {
        schema: outputSchema,
        render: renderResult,
      },
      async execute(args, exec): Promise<SearchResult> {
        const { query, courseId, topK } = args as {
          query: string
          courseId?: string
          topK?: number
        }
        try {
          return await searchKnowledge(auth, config, query, topK ?? 5, courseId, exec.signal)
        } catch (error) {
          throw toToolError(error, '知识库检索')
        }
      },
    }),
  )
}
