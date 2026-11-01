export interface Segment {
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

export interface RelatedKnowledgePoint {
  knowledgePointId: string
  title: string
}

export interface SearchResult {
  query: string
  segments: Segment[]
  relatedKnowledgePoints: RelatedKnowledgePoint[]
}

export interface PlaybackSession {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark?: { label: string }
}

export interface AuthStatus {
  mode: 'device' | 'credential' | 'none'
  authorized: boolean
  deviceId?: string
}

export interface DeviceAuthStart {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface DeviceAuthPoll {
  status: 'pending' | 'authorized' | 'expired'
}

export interface EventsConsent {
  consent: boolean
}

export interface CatalogCourseSummary {
  courseId: string
  title: string
  chapterCount: number
  knowledgePointCount: number
  completedCount: number
}

export interface CatalogKnowledgePoint {
  knowledgePointId: string
  title: string
  position: number
  segmentId?: string
  watchedSec: number
  completed: boolean
}

export interface CatalogChapter {
  chapterId: string
  title: string
  position: number
  hasArticle: boolean
  figureCount: number
  knowledgePoints: CatalogKnowledgePoint[]
}

export interface CatalogCourse {
  contractVersion: number
  courseId: string
  title: string
  chapters: CatalogChapter[]
}

export interface ChapterArticle {
  markdown: string
  version: number
  publishedAt: number
}

export interface ChapterFigure {
  url: string
  width: number
  height: number
  alt: string
  caption?: string
}

export interface RelatedChapter {
  chapterId: string
  title: string
}

export interface CatalogChapterArticle {
  chapterId: string
  courseId: string
  title: string
  article: ChapterArticle | null
  figures: Record<string, ChapterFigure>
  adjacentChapters: RelatedChapter[]
}

export interface KnowledgePointDetail {
  knowledgePointId: string
  courseId: string
  chapterId: string
  title: string
  segmentId?: string
  adjacentKnowledgePoints: RelatedKnowledgePoint[]
}

export interface ProgressResult {
  knowledgePointId: string
  watchedSec: number
  completed: boolean
  updatedAt: number
}

export interface LearnerContextUpdate {
  revision: number
  enabled: boolean
  courseId?: string
  courseTitle?: string
  chapterId?: string
  chapterTitle?: string
  knowledgePointId?: string
  knowledgePointTitle?: string
  positionSec?: number
  selectedText?: string
}

export interface LearnerContextAck {
  revision: number
  applied: boolean
  truncated: boolean
}

export interface VoiceTranscript {
  text: string
  durationMs: number
}

export const MAX_SEGMENT_TEXT = 4000
export const MAX_RELATED_POINTS = 5
export const MAX_TITLE_LENGTH = 200
export const MAX_COURSES = 50
export const MAX_CHAPTERS = 50
export const MAX_KNOWLEDGE_POINTS = 1000
export const MAX_CHAPTER_MARKDOWN_CHARS = 20000
export const MAX_FIGURES_PER_CHAPTER = 3
export const MIN_FIGURE_DIMENSION = 800
export const MAX_FIGURE_DIMENSION = 20000
export const MIN_CATALOG_CONTRACT_VERSION = 2
export const MAX_KNOWN_CATALOG_CONTRACT_VERSION = 2
export const MAX_WATCHED_SEC = 86400

export const MAX_LEARNER_SELECTED_RAW = 4000
export const MAX_LEARNER_SELECTED_CHARS = 500
export const MAX_LEARNER_SESSIONS = 64
export const LEARNER_CONTEXT_TTL_MS = 30 * 60 * 1000
export const LEARNER_POSITION_BUCKET_SEC = 15
export const LEARNER_CONTEXT_SECTION_ORDER = 8500

export const MAX_VOICE_DURATION_MS = 60000
export const VOICE_SAMPLE_RATE = 16000
export const VOICE_CHANNELS = 1
export const VOICE_BITS_PER_SAMPLE = 16
export const MAX_VOICE_TRANSCRIPT_CHARS = 2000
export const VOICE_WAV_HEADER_BYTES = 44
export const MAX_VOICE_WAV_BYTES =
  VOICE_WAV_HEADER_BYTES + (VOICE_SAMPLE_RATE * VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8) * MAX_VOICE_DURATION_MS) / 1000
export const MAX_VOICE_BASE64_CHARS = Math.ceil(MAX_VOICE_WAV_BYTES / 3) * 4
export const VOICE_REQUEST_TIMEOUT_MS = 40000
