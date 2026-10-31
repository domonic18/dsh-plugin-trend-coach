import { remoteErrorOf, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import {
  MAX_LEARNER_SELECTED_CHARS,
  MAX_LEARNER_SELECTED_RAW,
  MAX_TITLE_LENGTH,
  MAX_VOICE_DURATION_MS,
  MAX_WATCHED_SEC,
} from './shared/contracts.js'
import { sanitizeInlineUntrusted, sanitizeUntrusted, truncateCodePoints } from './untrusted.js'

export { MAX_WATCHED_SEC }

export const MAX_QUERY_LENGTH = 500
export const MAX_COURSE_ID_LENGTH = 64
export const MAX_SEGMENT_ID_LENGTH = 80
export const MAX_KNOWLEDGE_POINT_ID_LENGTH = 64
export const MAX_CHAPTER_ID_LENGTH = 64
export const MAX_SESSION_ID_LENGTH = 128
export const DEFAULT_TOP_K = 5
export const MAX_TOP_K = 20
export const MAX_RESPONSE_BYTES = 512 * 1024

const COURSE_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const SEGMENT_ID_PATTERN = /^seg-[A-Za-z0-9._-]+$/
const KNOWLEDGE_POINT_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const CHAPTER_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/

export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

export class AuthError extends Error {
  readonly code: 'UNAUTHORIZED' | 'AUTH_EXPIRED' | 'DEVICE_MISMATCH'

  constructor(message: string, code: AuthError['code']) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(messageForStatus(status))
    this.name = 'UpstreamError'
  }
}

export class InvalidResponseError extends Error {
  constructor(message = '课程服务返回的数据无法识别，请稍后重试') {
    super(message)
    this.name = 'InvalidResponseError'
  }
}

/** 语音失败文案已按学员可见口径收敛，原样透出，不拼接内部状态码。 */
export class VoiceTranscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceTranscriptionError'
  }
}

export async function readJsonResponse(response: Response, service = '课程服务'): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new InvalidResponseError(`${service}响应过大`)
  }
  if (response.body === null) {
    throw new InvalidResponseError(`${service}返回的数据无法识别，请稍后重试`)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new InvalidResponseError(`${service}响应过大`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new InvalidResponseError(`${service}返回的数据无法识别，请稍后重试`)
  }
}

function messageForStatus(status: number): string {
  if (status === 404) return '请求的内容不存在或已下架'
  if (status === 413) return '请求内容过大，请稍后重试'
  if (status === 429) return '请求过于频繁，请稍后重试'
  if (status >= 500) return '课程服务暂时不可用，请稍后重试'
  return '课程服务请求失败，请稍后重试'
}

function namedError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null
    && 'name' in error && (error as { name?: unknown }).name === name
}

export function isSegmentId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_SEGMENT_ID_LENGTH
    && SEGMENT_ID_PATTERN.test(value)
}

export function requireQuery(value: unknown): string {
  if (typeof value !== 'string') throw new InputError('检索语句必须是字符串')
  const query = value.trim()
  if (query.length === 0) throw new InputError('检索语句不能为空')
  if (query.length > MAX_QUERY_LENGTH) {
    throw new InputError(`检索语句不能超过 ${MAX_QUERY_LENGTH} 个字符`)
  }
  return query
}

export function optionalCourseId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InputError('课程 ID 必须是字符串')
  const courseId = value.trim()
  if (courseId.length === 0 || courseId.length > MAX_COURSE_ID_LENGTH || !COURSE_ID_PATTERN.test(courseId)) {
    throw new InputError('课程 ID 格式不合法')
  }
  return courseId
}

export function normalizeTopK(value: unknown): number {
  if (value === undefined) return DEFAULT_TOP_K
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InputError('topK 必须是数字')
  return Math.min(MAX_TOP_K, Math.max(1, Math.trunc(value)))
}

export function requireSegmentId(value: unknown): string {
  if (!isSegmentId(value)) throw new InputError('片段 ID 格式不合法')
  return value
}

export function requireCourseId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0
    || value.length > MAX_COURSE_ID_LENGTH || !COURSE_ID_PATTERN.test(value)) {
    throw new InputError('课程 ID 格式不合法')
  }
  return value
}

export function requireKnowledgePointId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0
    || value.length > MAX_KNOWLEDGE_POINT_ID_LENGTH || !KNOWLEDGE_POINT_ID_PATTERN.test(value)) {
    throw new InputError('知识点 ID 格式不合法')
  }
  return value
}

export function requireWatchedSec(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_WATCHED_SEC) {
    throw new InputError(`观看时长必须是 0–${MAX_WATCHED_SEC} 的整数秒`)
  }
  return value
}

export function requireCompleted(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new InputError('完成状态必须是布尔值')
  return value
}

export function requireSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0
    || value.length > MAX_SESSION_ID_LENGTH || !SESSION_ID_PATTERN.test(value)) {
    throw new InputError('会话 ID 格式不合法')
  }
  return value
}

export function requireRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InputError('revision 必须是非负安全整数')
  }
  return value
}

export function requireEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new InputError('上下文开关必须是布尔值')
  return value
}

export function optionalChapterId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InputError('章节 ID 必须是字符串')
  const chapterId = value.trim()
  if (chapterId.length === 0 || chapterId.length > MAX_CHAPTER_ID_LENGTH || !CHAPTER_ID_PATTERN.test(chapterId)) {
    throw new InputError('章节 ID 格式不合法')
  }
  return chapterId
}

export function optionalKnowledgePointId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return requireKnowledgePointId(value)
}

export function optionalContextTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InputError('标题必须是字符串')
  const title = sanitizeInlineUntrusted(value).replace(/\s+/g, ' ').trim()
  if (title.length === 0) return undefined
  if (title.length > MAX_TITLE_LENGTH) throw new InputError(`标题不能超过 ${MAX_TITLE_LENGTH} 个字符`)
  return title
}

export function optionalPositionSec(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_WATCHED_SEC) {
    throw new InputError(`播放位置必须是 0–${MAX_WATCHED_SEC} 的整数秒`)
  }
  return value
}

export function optionalSelectedText(value: unknown): { text: string | undefined; truncated: boolean } {
  if (value === undefined) return { text: undefined, truncated: false }
  if (typeof value !== 'string') throw new InputError('选中文本必须是字符串')
  if (value.length > MAX_LEARNER_SELECTED_RAW) {
    throw new InputError(`选中文本不能超过 ${MAX_LEARNER_SELECTED_RAW} 个字符`)
  }
  const sanitized = sanitizeUntrusted(value)
  const text = truncateCodePoints(sanitized, MAX_LEARNER_SELECTED_CHARS)
  const truncated = Array.from(sanitized).length > MAX_LEARNER_SELECTED_CHARS
  if (text.trim().length === 0) return { text: undefined, truncated: false }
  return { text, truncated }
}

export function requireVoiceDurationMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_VOICE_DURATION_MS) {
    throw new InputError(`录音时长必须是 1–${MAX_VOICE_DURATION_MS} 的整数毫秒`)
  }
  return value
}

export function userMessage(error: unknown, operation: string): string {
  if (error instanceof InputError) return error.message
  if (error instanceof AuthError) return error.message
  if (error instanceof UpstreamError) return error.message
  if (error instanceof InvalidResponseError) return error.message
  if (error instanceof VoiceTranscriptionError) return error.message
  if (namedError(error, 'TimeoutError')) return `${operation}超时，请稍后重试`
  if (namedError(error, 'AbortError')) return '请求已取消'
  if (error instanceof TypeError) return '无法连接课程服务，请检查网络后重试'
  return `${operation}失败，请稍后重试`
}

/** 统一映射成 Typert 线协议允许的失败码，避免把上游状态码/凭据带出 Host。 */
export function toRemoteError(error: unknown, operation: string): RemoteError {
  const existing = remoteErrorOf(error)
  if (existing !== undefined) return existing
  const message = userMessage(error, operation)
  if (error instanceof InputError) return new RemoteError('gateway/bad-request', message, {}, { cause: error })
  if (namedError(error, 'AbortError')) return new RemoteError('gateway/cancelled', message, {}, { cause: error })
  return new RemoteError('gateway/internal', message, {}, { cause: error })
}

export function toToolError(error: unknown, operation: string): Error {
  return new Error(userMessage(error, operation), { cause: error })
}
