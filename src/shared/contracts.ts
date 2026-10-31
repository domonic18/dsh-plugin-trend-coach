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
  knowledgePoints: CatalogKnowledgePoint[]
}

export interface CatalogCourse {
  courseId: string
  title: string
  chapters: CatalogChapter[]
}

export interface KnowledgePointArticle {
  markdown: string
  version: number
  publishedAt: number
}

export interface KnowledgePointDetail {
  knowledgePointId: string
  courseId: string
  chapterId: string
  title: string
  article: KnowledgePointArticle | null
  segmentId?: string
  adjacentKnowledgePoints: RelatedKnowledgePoint[]
}

export interface ProgressResult {
  knowledgePointId: string
  watchedSec: number
  completed: boolean
  updatedAt: number
}

export const MAX_SEGMENT_TEXT = 4000
export const MAX_RELATED_POINTS = 5
export const MAX_TITLE_LENGTH = 200
export const MAX_COURSES = 50
export const MAX_CHAPTERS = 50
export const MAX_KNOWLEDGE_POINTS = 1000
export const MAX_ARTICLE_CHARS = 20000
export const MAX_WATCHED_SEC = 86400
