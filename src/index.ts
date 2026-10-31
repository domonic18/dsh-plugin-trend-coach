import type { Context, Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  AuthManager,
  type AuthStatus,
  type DeviceAuthPoll,
  type DeviceAuthStart,
} from './auth.js'

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
  startSec: number
  endSec: number
  text: string
  score: number
}

interface SearchResult {
  query: string
  segments: Segment[]
}

interface PlaybackSession {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark?: { label: string }
}

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
          startSec: { type: 'number', required: true },
          endSec: { type: 'number', required: true },
          text: { type: 'string', required: true },
          score: { type: 'number', required: true },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const

function renderResult(_args: unknown, value: SearchResult): Array<{ type: 'text'; text: string }> {
  if (value.segments.length === 0) {
    return [{ type: 'text', text: '课程未覆盖该问题:知识库没有召回相关片段。' }]
  }

  const lines = [`检索到 ${value.segments.length} 个课程片段:`, '']
  for (const segment of value.segments) {
    lines.push(
      `[${segment.segmentId}] ${segment.title}`,
      `课程 ${segment.courseId} / 章节 ${segment.chapterId} / 知识点 ${segment.knowledgePointId}`,
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

function isSegment(value: unknown): value is Segment {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.segmentId === 'string' &&
    typeof candidate.courseId === 'string' &&
    typeof candidate.chapterId === 'string' &&
    typeof candidate.knowledgePointId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.startSec === 'number' &&
    typeof candidate.endSec === 'number' &&
    typeof candidate.text === 'string' &&
    typeof candidate.score === 'number'
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
  const body: Record<string, unknown> = { query, topK }
  if (courseId !== undefined) body.courseId = courseId

  const response = await auth.request('/v1/kb/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, signal)

  if (!response.ok) {
    throw new Error(`知识库检索失败: HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('知识库检索返回了非对象响应')
  }

  const rawSegments = (payload as { segments?: unknown }).segments
  if (!Array.isArray(rawSegments)) {
    throw new Error('知识库检索响应缺少 segments 数组')
  }

  const segments = rawSegments.filter(isSegment)
  if (segments.length !== rawSegments.length) {
    throw new Error('知识库检索响应包含不合法的片段')
  }

  return { query, segments }
}

async function getSegment(
  auth: AuthManager,
  config: Config,
  segmentId: string,
  signal: AbortSignal,
): Promise<Segment> {
  const response = await auth.request(
    `/v1/kb/segments/${encodeURIComponent(segmentId)}`,
    {},
    signal,
  )

  if (!response.ok) {
    throw new Error(`片段查询失败: HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  if (!isSegment(payload)) {
    throw new Error('片段查询响应不合法')
  }
  return payload
}

function isPlaybackSession(value: unknown): value is PlaybackSession {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  const watermark = candidate.watermark
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.playlistUrl === 'string' &&
    typeof candidate.expiresAt === 'number' &&
    (watermark === undefined ||
      (typeof watermark === 'object' && watermark !== null && typeof (watermark as Record<string, unknown>).label === 'string'))
  )
}

async function createPlaybackSession(
  auth: AuthManager,
  config: Config,
  segmentId: string,
  signal: AbortSignal,
): Promise<PlaybackSession> {
  const response = await auth.request('/v1/playback/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ segmentId }),
  }, signal)

  if (!response.ok) {
    throw new Error(`播放会话创建失败: HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  if (!isPlaybackSession(payload)) {
    throw new Error('播放会话响应不合法')
  }
  return payload
}

class TrendCoachService extends TypertRemoteService {
  private readonly config: Config
  private readonly auth: AuthManager

  constructor(ctx: Context, config: Config, auth: AuthManager) {
    super(ctx, 'trendCoach')
    this.config = config
    this.auth = auth
  }

  @Remote
  async search(query: string, topK: number, signal: AbortSignal): Promise<SearchResult> {
    return await searchKnowledge(this.auth, this.config, query, topK, undefined, signal)
  }

  @Remote
  async getSegment(segmentId: string, signal: AbortSignal): Promise<Segment> {
    return await getSegment(this.auth, this.config, segmentId, signal)
  }

  @Remote
  async createPlaybackSession(segmentId: string, signal: AbortSignal): Promise<PlaybackSession> {
    return await createPlaybackSession(this.auth, this.config, segmentId, signal)
  }

  @Remote
  async authStatus(): Promise<AuthStatus> {
    return await this.auth.status()
  }

  @Remote
  async beginDeviceAuth(signal: AbortSignal): Promise<DeviceAuthStart> {
    return await this.auth.beginDeviceAuth(signal)
  }

  @Remote
  async pollDeviceAuth(signal: AbortSignal): Promise<DeviceAuthPoll> {
    return await this.auth.pollDeviceAuth(signal)
  }

  @Remote
  async signOut(): Promise<{ signedOut: true }> {
    await this.auth.signOut()
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
        + '没有召回结果时,明确告诉学员课程未覆盖该问题。',
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
        return await searchKnowledge(auth, config, query, topK ?? 5, courseId, exec.signal)
      },
    }),
  )
}
