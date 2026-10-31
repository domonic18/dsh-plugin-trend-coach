import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export const name = 'trend-coach'

export const inject = ['tools']

export interface Config {
  baseUrl: string
  apiToken?: string
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().default('http://127.0.0.1:3939'),
  apiToken: Schema.string(),
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
  config: Config,
  query: string,
  topK: number,
  courseId: string | undefined,
  signal: AbortSignal,
): Promise<SearchResult> {
  const body: Record<string, unknown> = { query, topK }
  if (courseId !== undefined) body.courseId = courseId

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`

  const combined = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
  const response = await fetch(`${config.baseUrl}/v1/kb/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: combined,
  })

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
  config: Config,
  segmentId: string,
  signal: AbortSignal,
): Promise<Segment> {
  const headers: Record<string, string> = {}
  if (config.apiToken) headers.authorization = `Bearer ${config.apiToken}`

  const combined = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
  const response = await fetch(`${config.baseUrl}/v1/kb/segments/${encodeURIComponent(segmentId)}`, {
    headers,
    signal: combined,
  })

  if (!response.ok) {
    throw new Error(`片段查询失败: HTTP ${response.status} ${response.statusText}`)
  }

  const payload: unknown = await response.json()
  if (!isSegment(payload)) {
    throw new Error('片段查询响应不合法')
  }
  return payload
}

class TrendCoachService extends TypertRemoteService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'trendCoach')
    this.config = config
  }

  @Remote
  async search(query: string, topK: number, signal: AbortSignal): Promise<SearchResult> {
    return await searchKnowledge(this.config, query, topK, undefined, signal)
  }

  @Remote
  async getSegment(segmentId: string, signal: AbortSignal): Promise<Segment> {
    return await getSegment(this.config, segmentId, signal)
  }
}

export function apply(ctx: Context, config: Config): void {
  new TrendCoachService(ctx, config)

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
        return await searchKnowledge(config, query, topK ?? 5, courseId, exec.signal)
      },
    }),
  )
}
