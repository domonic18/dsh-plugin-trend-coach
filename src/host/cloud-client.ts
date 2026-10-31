import type { AuthManager } from '../auth.js'
import {
  InvalidResponseError,
  UpstreamError,
  VoiceTranscriptionError,
  isSegmentId,
  normalizeTopK,
  optionalCourseId,
  readJsonResponse,
  requireCompleted,
  requireCourseId,
  requireKnowledgePointId,
  requireQuery,
  requireSegmentId,
  requireVoiceDurationMs,
  requireWatchedSec,
} from '../errors.js'
import { sanitizeVoiceText } from '../untrusted.js'
import {
  MAX_ARTICLE_CHARS,
  MAX_CHAPTERS,
  MAX_COURSES,
  MAX_KNOWLEDGE_POINTS,
  MAX_RELATED_POINTS,
  MAX_SEGMENT_TEXT,
  MAX_TITLE_LENGTH,
  MAX_VOICE_DURATION_MS,
  MAX_VOICE_TRANSCRIPT_CHARS,
  MAX_WATCHED_SEC,
  type CatalogChapter,
  type CatalogCourse,
  type CatalogCourseSummary,
  type CatalogKnowledgePoint,
  type KnowledgePointArticle,
  type KnowledgePointDetail,
  type PlaybackSession,
  type ProgressResult,
  type RelatedKnowledgePoint,
  type SearchResult,
  type Segment,
  type VoiceTranscript,
} from '../shared/contracts.js'
import { decodeVoiceWav } from './voice-audio.js'

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

function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}

function isKnowledgePointId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    && /^[A-Za-z0-9._-]+$/.test(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isCatalogCourseSummary(value: unknown): value is CatalogCourseSummary {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isCourseId(candidate.courseId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    isCount(candidate.chapterCount) &&
    isCount(candidate.knowledgePointCount) &&
    isCount(candidate.completedCount) &&
    candidate.completedCount <= candidate.knowledgePointCount
  )
}

function isCatalogKnowledgePoint(value: unknown): value is CatalogKnowledgePoint {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if ('startSec' in candidate || 'endSec' in candidate) return false
  return (
    isKnowledgePointId(candidate.knowledgePointId) &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.position === 'number' && Number.isInteger(candidate.position) &&
    (candidate.segmentId === undefined || isSegmentId(candidate.segmentId)) &&
    typeof candidate.watchedSec === 'number' && Number.isInteger(candidate.watchedSec)
      && candidate.watchedSec >= 0 && candidate.watchedSec <= MAX_WATCHED_SEC &&
    typeof candidate.completed === 'boolean'
  )
}

function isCatalogChapter(value: unknown): value is CatalogChapter {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.chapterId === 'string' && candidate.chapterId.length > 0
      && candidate.chapterId.length <= 64 &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    typeof candidate.position === 'number' && Number.isInteger(candidate.position) &&
    Array.isArray(candidate.knowledgePoints) && candidate.knowledgePoints.every(isCatalogKnowledgePoint)
  )
}

function isCatalogCourse(value: unknown): value is CatalogCourse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!isCourseId(candidate.courseId)) return false
  if (typeof candidate.title !== 'string' || candidate.title.length === 0
    || candidate.title.length > MAX_TITLE_LENGTH) return false
  if (!Array.isArray(candidate.chapters) || candidate.chapters.length > MAX_CHAPTERS) return false
  if (!candidate.chapters.every(isCatalogChapter)) return false
  const points = (candidate.chapters as CatalogChapter[])
    .reduce((total, chapter) => total + chapter.knowledgePoints.length, 0)
  return points <= MAX_KNOWLEDGE_POINTS
}

function isKnowledgePointArticle(value: unknown): value is KnowledgePointArticle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.markdown === 'string' && candidate.markdown.length > 0
      && candidate.markdown.length <= MAX_ARTICLE_CHARS &&
    typeof candidate.version === 'number' && Number.isInteger(candidate.version) && candidate.version >= 1 &&
    typeof candidate.publishedAt === 'number' && Number.isFinite(candidate.publishedAt)
      && candidate.publishedAt > 0
  )
}

function isKnowledgePointDetail(value: unknown): value is KnowledgePointDetail {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isKnowledgePointId(candidate.knowledgePointId) &&
    isCourseId(candidate.courseId) &&
    typeof candidate.chapterId === 'string' && candidate.chapterId.length > 0
      && candidate.chapterId.length <= 64 &&
    typeof candidate.title === 'string' && candidate.title.length > 0
      && candidate.title.length <= MAX_TITLE_LENGTH &&
    (candidate.article === null || isKnowledgePointArticle(candidate.article)) &&
    (candidate.segmentId === undefined || isSegmentId(candidate.segmentId)) &&
    Array.isArray(candidate.adjacentKnowledgePoints) &&
    candidate.adjacentKnowledgePoints.length <= MAX_RELATED_POINTS &&
    candidate.adjacentKnowledgePoints.every(isRelatedKnowledgePoint)
  )
}

function isProgressResult(value: unknown, knowledgePointId: string): value is ProgressResult {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.knowledgePointId === knowledgePointId &&
    typeof candidate.watchedSec === 'number' && Number.isInteger(candidate.watchedSec)
      && candidate.watchedSec >= 0 && candidate.watchedSec <= MAX_WATCHED_SEC &&
    typeof candidate.completed === 'boolean' &&
    typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
  )
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

export async function listCourses(
  auth: AuthManager,
  signal: AbortSignal,
): Promise<{ courses: CatalogCourseSummary[] }> {
  const response = await auth.request('/v1/catalog/courses', {}, signal)
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('课程服务返回了非对象响应')
  }
  const rawCourses = (payload as { courses?: unknown }).courses
  if (!Array.isArray(rawCourses) || rawCourses.length > MAX_COURSES
    || !rawCourses.every(isCatalogCourseSummary)) {
    throw new InvalidResponseError('课程服务返回的课程列表不合法')
  }
  return { courses: rawCourses }
}

export async function getCatalogCourse(
  auth: AuthManager,
  courseId: string,
  signal: AbortSignal,
): Promise<CatalogCourse> {
  const normalizedCourseId = requireCourseId(courseId)
  const response = await auth.request(
    `/v1/catalog/courses/${encodeURIComponent(normalizedCourseId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isCatalogCourse(payload) || payload.courseId !== normalizedCourseId) {
    throw new InvalidResponseError('课程服务返回的课程结构不合法')
  }
  return payload
}

export async function getKnowledgePoint(
  auth: AuthManager,
  knowledgePointId: string,
  signal: AbortSignal,
): Promise<KnowledgePointDetail> {
  const normalizedId = requireKnowledgePointId(knowledgePointId)
  const response = await auth.request(
    `/v1/catalog/knowledge-points/${encodeURIComponent(normalizedId)}`,
    {},
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isKnowledgePointDetail(payload) || payload.knowledgePointId !== normalizedId) {
    throw new InvalidResponseError('课程服务返回的知识点详情不合法')
  }
  return payload
}

function voiceErrorForStatus(status: number): VoiceTranscriptionError {
  if (status === 400) return new VoiceTranscriptionError('录音数据无效，请重试')
  if (status === 413) return new VoiceTranscriptionError('录音过长，请缩短后重试')
  if (status === 422) return new VoiceTranscriptionError('没有听清，请再说一次')
  if (status === 429) return new VoiceTranscriptionError('操作太频繁，请稍后再试')
  if (status === 502 || status === 503) return new VoiceTranscriptionError('语音服务暂时不可用，请稍后重试')
  return new VoiceTranscriptionError('语音转写失败，请稍后重试')
}

export async function transcribeVoice(
  auth: AuthManager,
  audioBase64: string,
  durationMs: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<VoiceTranscript> {
  const validatedDuration = requireVoiceDurationMs(durationMs)
  decodeVoiceWav(audioBase64, validatedDuration)

  const response = await auth.request('/v1/asr/transcribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64, format: 'wav', durationMs: validatedDuration }),
  }, signal, timeoutMs)

  if (!response.ok) throw voiceErrorForStatus(response.status)

  const payload = await readJsonResponse(response, '语音转写服务')
  if (typeof payload !== 'object' || payload === null) {
    throw new InvalidResponseError('语音转写服务返回了非对象响应')
  }
  const candidate = payload as Record<string, unknown>
  if (typeof candidate.text !== 'string'
    || typeof candidate.durationMs !== 'number' || !Number.isInteger(candidate.durationMs)
    || candidate.durationMs < 1 || candidate.durationMs > MAX_VOICE_DURATION_MS) {
    throw new InvalidResponseError('语音转写服务返回的数据不合法')
  }

  const text = sanitizeVoiceText(candidate.text)
  if (text.length === 0 || Array.from(text).length > MAX_VOICE_TRANSCRIPT_CHARS) {
    throw new InvalidResponseError('语音转写服务返回的文本不合法')
  }
  return { text, durationMs: validatedDuration }
}

export async function reportProgress(
  auth: AuthManager,
  knowledgePointId: string,
  watchedSec: number,
  completed: boolean,
  signal: AbortSignal,
): Promise<ProgressResult> {
  const normalizedId = requireKnowledgePointId(knowledgePointId)
  const normalizedWatchedSec = requireWatchedSec(watchedSec)
  const normalizedCompleted = requireCompleted(completed)
  const response = await auth.request(
    `/v1/progress/knowledge-points/${encodeURIComponent(normalizedId)}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ watchedSec: normalizedWatchedSec, completed: normalizedCompleted }),
    },
    signal,
  )
  if (!response.ok) throw new UpstreamError(response.status)

  const payload = await readJsonResponse(response)
  if (!isProgressResult(payload, normalizedId)) {
    throw new InvalidResponseError('课程服务返回的进度结果不合法')
  }
  return payload
}
