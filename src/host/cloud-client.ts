import type { AuthManager } from '../auth.js'
import {
  InvalidResponseError,
  UpstreamError,
  isSegmentId,
  normalizeTopK,
  optionalCourseId,
  readJsonResponse,
  requireQuery,
  requireSegmentId,
} from '../errors.js'
import {
  MAX_RELATED_POINTS,
  MAX_SEGMENT_TEXT,
  MAX_TITLE_LENGTH,
  type PlaybackSession,
  type RelatedKnowledgePoint,
  type SearchResult,
  type Segment,
} from '../shared/contracts.js'

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

export function isSegment(value: unknown): value is Segment {
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

export async function searchKnowledge(
  auth: AuthManager,
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

export async function getSegment(
  auth: AuthManager,
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

export async function createPlaybackSession(
  auth: AuthManager,
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
