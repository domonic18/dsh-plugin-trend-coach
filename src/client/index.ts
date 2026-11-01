import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import Hls from 'hls.js'
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteSpec } from '@deepseek-ai/dsh-typert-protocol/types'
import type {
  AuthStatus,
  CatalogChapterArticle,
  CatalogCourse,
  CatalogCourseSummary,
  DeviceAuthStart,
  KnowledgePointDetail,
  LearnerContextUpdate,
  PlaybackSession,
  ProgressResult,
  SearchResult,
  Segment,
} from '../shared/contracts.js'
import { CatalogPanel } from './catalog.js'
import { LearnerContextBridge } from './context-bridge.js'
import { learnerContextStore } from './learner-context.js'
import { installSelectionDetector } from './selection.js'
import type { ComposerInputActions } from './voice/controller.js'
import { VoiceButton } from './voice/voice-button.js'
import type {
  RemoteAuthStatusResult,
  RemoteCatalogChapterResult,
  RemoteCatalogCourseResult,
  RemoteCatalogCoursesResult,
  RemoteDeviceAuthPollResult,
  RemoteDeviceAuthStartResult,
  RemoteEventsConsentResult,
  RemoteKnowledgePointResult,
  RemoteLearnerContextResult,
  RemotePlaybackResult,
  RemoteProgressResult,
  RemoteReportResult,
  RemoteSearchResult,
  RemoteSegmentResult,
  RemoteSignOutResult,
  RemoteVoiceTranscriptResult,
} from './dsh.js'

export const name = 'trend-coach-client'

export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote']

const TAB_ID = 'dsh-plugin-trend-coach'
const CATALOG_ID = 'dsh-plugin-trend-coach-catalog'
const PLAYER_ID = 'dsh-plugin-trend-coach-player'
const CATALOG_KIND = 'trend-coach-catalog'
const PLAYER_KIND = 'trend-coach-player'
const CITATION_HOST = 'trend-coach.local'
const SEGMENT_CODE = /^seg-[A-Za-z0-9._-]+$/
const SEGMENT_CLIP_SEC = 60
const MAX_QUERY_LENGTH = 500
const DISCLAIMER = '课程内容仅供学习，不构成投资建议。'

const segmentSchema = z.object({
  segmentId: z.string(),
  courseId: z.string(),
  chapterId: z.string(),
  knowledgePointId: z.string(),
  title: z.string(),
  courseTitle: z.string().optional(),
  chapterTitle: z.string().optional(),
  knowledgePointTitle: z.string().optional(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  score: z.number(),
})

const playbackSessionSchema = z.object({
  sessionId: z.string(),
  playlistUrl: z.string(),
  expiresAt: z.number(),
  watermark: z.object({ label: z.string() }).optional(),
})

const relatedKnowledgePointSchema = z.object({
  knowledgePointId: z.string(),
  title: z.string(),
})

const resultSchema = z.object({
  query: z.string(),
  segments: z.array(segmentSchema),
  relatedKnowledgePoints: z.array(relatedKnowledgePointSchema),
})

const authStatusSchema = z.object({
  mode: z.enum(['device', 'credential', 'none']),
  authorized: z.boolean(),
  deviceId: z.string().optional(),
})

const deviceAuthStartSchema = z.object({
  userCode: z.string(),
  verificationUri: z.string(),
  expiresAt: z.number(),
  interval: z.number(),
})

const deviceAuthPollSchema = z.object({
  status: z.enum(['pending', 'authorized', 'expired']),
})

const signOutSchema = z.object({ signedOut: z.literal(true) })

const eventsConsentSchema = z.object({ consent: z.boolean() })

const reportSchema = z.object({ reported: z.literal(true) })

const catalogCourseSummarySchema = z.object({
  courseId: z.string(),
  title: z.string(),
  chapterCount: z.number(),
  knowledgePointCount: z.number(),
  completedCount: z.number(),
})

const catalogKnowledgePointSchema = z.object({
  knowledgePointId: z.string(),
  title: z.string(),
  position: z.number(),
  segmentId: z.string().optional(),
  watchedSec: z.number(),
  completed: z.boolean(),
})

const catalogChapterSchema = z.object({
  chapterId: z.string(),
  title: z.string(),
  position: z.number(),
  hasArticle: z.boolean(),
  figureCount: z.number(),
  knowledgePoints: z.array(catalogKnowledgePointSchema),
})

const catalogCourseSchema = z.object({
  contractVersion: z.number(),
  courseId: z.string(),
  title: z.string(),
  chapters: z.array(catalogChapterSchema),
})

const chapterArticleSchema = z.object({
  markdown: z.string(),
  version: z.number(),
  publishedAt: z.number(),
})

const chapterFigureSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
  alt: z.string(),
  caption: z.string().optional(),
})

const relatedChapterSchema = z.object({
  chapterId: z.string(),
  title: z.string(),
})

const catalogChapterArticleSchema = z.object({
  chapterId: z.string(),
  courseId: z.string(),
  title: z.string(),
  article: z.union([chapterArticleSchema, z.null()]),
  figures: z.record(z.string(), chapterFigureSchema),
  adjacentChapters: z.array(relatedChapterSchema),
})

const knowledgePointDetailSchema = z.object({
  knowledgePointId: z.string(),
  courseId: z.string(),
  chapterId: z.string(),
  title: z.string(),
  segmentId: z.string().optional(),
  adjacentKnowledgePoints: z.array(relatedKnowledgePointSchema),
})

const progressSchema = z.object({
  knowledgePointId: z.string(),
  watchedSec: z.number(),
  completed: z.boolean(),
  updatedAt: z.number(),
})

const learnerContextUpdateSchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  courseId: z.string().optional(),
  courseTitle: z.string().optional(),
  chapterId: z.string().optional(),
  chapterTitle: z.string().optional(),
  knowledgePointId: z.string().optional(),
  knowledgePointTitle: z.string().optional(),
  positionSec: z.number().int().min(0).max(86400).optional(),
  selectedText: z.string().optional(),
})

const learnerContextAckSchema = z.object({
  revision: z.number(),
  applied: z.boolean(),
  truncated: z.boolean(),
})

const voiceTranscriptSchema = z.object({
  text: z.string(),
  durationMs: z.number(),
})

const codec = (typeSymbol: string, create: () => z.ZodType) => ({
  mode: 'strict' as const,
  typeSymbol,
  create,
})

const spec: TypertRemoteSpec = {
  package: 'dsh-plugin-trend-coach',
  methods: {
    'trendCoach/search': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'query',
          wire: 'query',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/search:query', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/search:query', () => z.string()),
        },
        {
          name: 'topK',
          wire: 'topK',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/search:topK', () => z.number()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/search:topK', () => z.number()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec('dsh-plugin-trend-coach#trendCoach/search:result', () => resultSchema),
    },
    'trendCoach/getSegment': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'segmentId',
          wire: 'segmentId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/getSegment:segmentId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/getSegment:segmentId', () => z.string()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec('dsh-plugin-trend-coach#trendCoach/getSegment:result', () => segmentSchema),
    },
    'trendCoach/createPlaybackSession': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'segmentId',
          wire: 'segmentId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/createPlaybackSession:segmentId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/createPlaybackSession:segmentId', () => z.string()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/createPlaybackSession:result',
        () => playbackSessionSchema,
      ),
    },
    'trendCoach/catalogCourses': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/catalogCourses:result',
        () => z.object({ courses: z.array(catalogCourseSummarySchema) }),
      ),
    },
    'trendCoach/catalogCourse': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'courseId',
          wire: 'courseId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/catalogCourse:courseId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/catalogCourse:courseId', () => z.string()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec('dsh-plugin-trend-coach#trendCoach/catalogCourse:result', () => catalogCourseSchema),
    },
    'trendCoach/catalogChapter': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'courseId',
          wire: 'courseId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/catalogChapter:courseId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/catalogChapter:courseId', () => z.string()),
        },
        {
          name: 'chapterId',
          wire: 'chapterId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/catalogChapter:chapterId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/catalogChapter:chapterId', () => z.string()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/catalogChapter:result',
        () => catalogChapterArticleSchema,
      ),
    },
    'trendCoach/knowledgePoint': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'knowledgePointId',
          wire: 'knowledgePointId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/knowledgePoint:knowledgePointId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/knowledgePoint:knowledgePointId', () => z.string()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/knowledgePoint:result',
        () => knowledgePointDetailSchema,
      ),
    },
    'trendCoach/reportProgress': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'knowledgePointId',
          wire: 'knowledgePointId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:knowledgePointId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:knowledgePointId', () => z.string()),
        },
        {
          name: 'watchedSec',
          wire: 'watchedSec',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:watchedSec', () => z.number()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:watchedSec', () => z.number()),
        },
        {
          name: 'completed',
          wire: 'completed',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:completed', () => z.boolean()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:completed', () => z.boolean()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec('dsh-plugin-trend-coach#trendCoach/reportProgress:result', () => progressSchema),
    },
    'trendCoach/setLearnerContext': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'sessionId',
          wire: 'sessionId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/setLearnerContext:sessionId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/setLearnerContext:sessionId', () => z.string()),
        },
        {
          name: 'update',
          wire: 'update',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/setLearnerContext:update', () => learnerContextUpdateSchema),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/setLearnerContext:update', () => learnerContextUpdateSchema),
        },
      ],
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/setLearnerContext:result',
        () => learnerContextAckSchema,
      ),
    },
    'trendCoach/transcribeVoice': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'audioBase64',
          wire: 'audioBase64',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/transcribeVoice:audioBase64', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/transcribeVoice:audioBase64', () => z.string()),
        },
        {
          name: 'durationMs',
          wire: 'durationMs',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/transcribeVoice:durationMs', () => z.number()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/transcribeVoice:durationMs', () => z.number()),
        },
      ],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/transcribeVoice:result',
        () => voiceTranscriptSchema,
      ),
    },
    'trendCoach/authStatus': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('dsh-plugin-trend-coach#trendCoach/authStatus:result', () => authStatusSchema),
    },
    'trendCoach/beginDeviceAuth': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/beginDeviceAuth:result',
        () => deviceAuthStartSchema,
      ),
    },
    'trendCoach/pollDeviceAuth': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      cancellation: { parameter: 'signal' },
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/pollDeviceAuth:result',
        () => deviceAuthPollSchema,
      ),
    },
    'trendCoach/eventConsent': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/eventConsent:result',
        () => eventsConsentSchema,
      ),
    },
    'trendCoach/setEventConsent': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'consent',
          wire: 'consent',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/setEventConsent:consent', () => z.boolean()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/setEventConsent:consent', () => z.boolean()),
        },
      ],
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/setEventConsent:result',
        () => eventsConsentSchema,
      ),
    },
    'trendCoach/reportCitationClick': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'segmentId',
          wire: 'segmentId',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportCitationClick:segmentId', () => z.string()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportCitationClick:segmentId', () => z.string()),
        },
      ],
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/reportCitationClick:result',
        () => reportSchema,
      ),
    },
    'trendCoach/reportPlayerStarted': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'startupMs',
          wire: 'startupMs',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportPlayerStarted:startupMs', () => z.number()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportPlayerStarted:startupMs', () => z.number()),
        },
        {
          name: 'autoplayBlocked',
          wire: 'autoplayBlocked',
          source: 'json',
          codec: codec('dsh-plugin-trend-coach#trendCoach/reportPlayerStarted:autoplayBlocked', () => z.boolean()),
          strictCodec: codec('dsh-plugin-trend-coach#trendCoach/reportPlayerStarted:autoplayBlocked', () => z.boolean()),
        },
      ],
      result: codec(
        'dsh-plugin-trend-coach#trendCoach/reportPlayerStarted:result',
        () => reportSchema,
      ),
    },
    'trendCoach/signOut': {
      service: 'trendCoach',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('dsh-plugin-trend-coach#trendCoach/signOut:result', () => signOutSchema),
    },
  },
}

interface TrendCoachRemote {
  getSegment(segmentId: string): Promise<RemoteSegmentResult>
  createPlaybackSession(segmentId: string): Promise<RemotePlaybackResult>
  catalogCourses(): Promise<RemoteCatalogCoursesResult>
  catalogCourse(courseId: string): Promise<RemoteCatalogCourseResult>
  catalogChapter(courseId: string, chapterId: string): Promise<RemoteCatalogChapterResult>
  knowledgePoint(knowledgePointId: string): Promise<RemoteKnowledgePointResult>
  reportProgress(
    knowledgePointId: string,
    watchedSec: number,
    completed: boolean,
  ): Promise<RemoteProgressResult>
  setLearnerContext(sessionId: string, update: LearnerContextUpdate): Promise<RemoteLearnerContextResult>
  transcribeVoice(audioBase64: string, durationMs: number): Promise<RemoteVoiceTranscriptResult>
  authStatus(): Promise<RemoteAuthStatusResult>
  beginDeviceAuth(): Promise<RemoteDeviceAuthStartResult>
  pollDeviceAuth(): Promise<RemoteDeviceAuthPollResult>
  eventConsent(): Promise<RemoteEventsConsentResult>
  setEventConsent(consent: boolean): Promise<RemoteEventsConsentResult>
  reportCitationClick(segmentId: string): Promise<RemoteReportResult>
  reportPlayerStarted(startupMs: number, autoplayBlocked: boolean): Promise<RemoteReportResult>
  signOut(): Promise<RemoteSignOutResult>
}

interface PlayerParams {
  segmentId?: string
  courseId?: string
  courseTitle?: string
  chapterId?: string
  chapterTitle?: string
  knowledgePointId?: string
  knowledgePointTitle?: string
  title?: string
  startSec?: number
  endSec?: number
  src?: string
  watermark?: string
  error?: string
}

interface TabInfoHook {
  (): {
    tab: {
      navigation: {
        address: string
        params?: Record<string, unknown>
        revision: number
      }
    }
  }
}

interface PanelProps {
  search: (query: string) => Promise<RemoteSearchResult>
  openSegment: (params: PlayerParams) => Promise<void>
  authStatus: () => Promise<RemoteAuthStatusResult>
  beginDeviceAuth: () => Promise<RemoteDeviceAuthStartResult>
  pollDeviceAuth: () => Promise<RemoteDeviceAuthPollResult>
  eventConsent: () => Promise<RemoteEventsConsentResult>
  setEventConsent: (consent: boolean) => Promise<RemoteEventsConsentResult>
  reportCitationClick: (segmentId: string) => Promise<RemoteReportResult>
  signOut: () => Promise<RemoteSignOutResult>
}

interface PlayerProps {
  useTabInfo?: TabInfoHook
  reportPlayerStarted?: (startupMs: number, autoplayBlocked: boolean) => void
  reportProgress?: (
    knowledgePointId: string,
    watchedSec: number,
    completed: boolean,
  ) => Promise<RemoteProgressResult> | void
}

function displayTitle(title: string | undefined, id: string): string {
  return title === undefined || title.length === 0 ? id : title
}

interface PanelCache {
  query: string
  payload?: SearchResult
  error?: string
  auth?: AuthStatus
  device?: DeviceAuthStart
  consent?: boolean
}

// 切换右栏 tab 会重建面板；跨挂载保留检索结果与授权状态，避免输入和结果丢失。
const panelCache: PanelCache = { query: '趋势反转怎么判断' }

function Panel({
  search,
  openSegment,
  authStatus,
  beginDeviceAuth,
  pollDeviceAuth,
  eventConsent,
  setEventConsent,
  reportCitationClick,
  signOut,
}: PanelProps): React.ReactElement {
  const [query, setQuery] = React.useState(() => panelCache.query)
  const [busy, setBusy] = React.useState(false)
  const [payload, setPayload] = React.useState<SearchResult | undefined>(() => panelCache.payload)
  const [error, setError] = React.useState<string | undefined>(() => panelCache.error)

  const [auth, setAuth] = React.useState<AuthStatus | undefined>(() => panelCache.auth)
  const [device, setDevice] = React.useState<DeviceAuthStart | undefined>(() => panelCache.device)
  const [authBusy, setAuthBusy] = React.useState(false)
  const [authError, setAuthError] = React.useState<string | undefined>(undefined)

  const [consent, setConsent] = React.useState<boolean | undefined>(() => panelCache.consent)
  const [consentBusy, setConsentBusy] = React.useState(false)
  const [consentError, setConsentError] = React.useState<string | undefined>(undefined)
  const authorized = auth?.authorized === true

  React.useEffect(() => {
    panelCache.query = query
    panelCache.payload = payload
    panelCache.error = error
    panelCache.auth = auth
    panelCache.device = device
    panelCache.consent = consent
  }, [query, payload, error, auth, device, consent])

  const refreshAuth = React.useCallback(async () => {
    try {
      const result = await authStatus()
      if (result.ok) {
        setAuth(result.value)
      } else {
        setAuthError(result.error.message)
      }
    } catch (authFailure: unknown) {
      setAuthError(authFailure instanceof Error ? authFailure.message : '授权状态读取失败')
    }
  }, [authStatus])

  React.useEffect(() => {
    void refreshAuth()
  }, [refreshAuth])

  React.useEffect(() => {
    if (!authorized) {
      setConsent(undefined)
      setConsentError(undefined)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await eventConsent()
        if (cancelled) return
        if (result.ok) {
          setConsent(result.value.consent)
        } else {
          setConsent(undefined)
          setConsentError(result.error.message)
        }
      } catch (consentFailure: unknown) {
        if (cancelled) return
        setConsent(undefined)
        setConsentError(consentFailure instanceof Error ? consentFailure.message : '指标同意状态读取失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authorized, eventConsent])

  const toggleConsent = async () => {
    const next = consent !== true
    setConsentBusy(true)
    setConsentError(undefined)
    try {
      const result = await setEventConsent(next)
      if (result.ok) setConsent(result.value.consent)
      else setConsentError(result.error.message)
    } catch (consentFailure: unknown) {
      setConsentError(consentFailure instanceof Error ? consentFailure.message : '指标同意更新失败')
    }
    setConsentBusy(false)
  }

  React.useEffect(() => {
    if (device === undefined) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const result = await pollDeviceAuth()
        if (cancelled) return
        if (!result.ok) {
          setAuthError(result.error.message)
          setDevice(undefined)
          return
        }
        if (result.value.status === 'authorized') {
          setDevice(undefined)
          await refreshAuth()
          return
        }
        if (result.value.status === 'expired') {
          setDevice(undefined)
          setAuthError('设备码已过期，请重新发起登录')
          return
        }
        timer = setTimeout(() => void tick(), device.interval * 1000)
      } catch (pollFailure: unknown) {
        if (cancelled) return
        setAuthError(pollFailure instanceof Error ? pollFailure.message : '设备授权轮询失败')
        setDevice(undefined)
      }
    }
    timer = setTimeout(() => void tick(), device.interval * 1000)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [device, pollDeviceAuth, refreshAuth])

  const login = async () => {
    setAuthBusy(true)
    setAuthError(undefined)
    try {
      const result = await beginDeviceAuth()
      if (result.ok) setDevice(result.value)
      else setAuthError(result.error.message)
    } catch (loginFailure: unknown) {
      setAuthError(loginFailure instanceof Error ? loginFailure.message : '设备授权发起失败')
    }
    setAuthBusy(false)
  }

  const logout = async () => {
    setAuthBusy(true)
    setAuthError(undefined)
    try {
      const result = await signOut()
      if (!result.ok) setAuthError(result.error.message)
      await refreshAuth()
    } catch (logoutFailure: unknown) {
      setAuthError(logoutFailure instanceof Error ? logoutFailure.message : '退出登录失败')
    }
    setAuthBusy(false)
  }

  const run = async () => {
    const value = query.trim()
    if (value.length === 0) {
      setPayload(undefined)
      setError('请输入问题')
      return
    }
    setBusy(true)
    setError(undefined)
    const result = await search(value)
    if (result.ok) {
      setPayload(result.value)
    } else {
      setPayload(undefined)
      setError(result.error.message)
    }
    setBusy(false)
  }

  const body: React.ReactNode[] = []
  if (error !== undefined) body.push(React.createElement('p', { key: 'error', style: { color: '#c0392b' } }, error))
  if (payload !== undefined) {
    if (payload.segments.length === 0) {
      body.push(React.createElement('p', { key: 'empty' }, '课程未覆盖该问题。'))
      if (payload.relatedKnowledgePoints.length > 0) {
        body.push(
          React.createElement('p', { key: 'related-title', style: { margin: '4px 0', color: '#666' } }, '相关知识点（仅标题）：'),
          React.createElement('ul', { key: 'related', style: { margin: '0 0 8px', paddingLeft: 18 } },
            ...payload.relatedKnowledgePoints.map((point) =>
              React.createElement('li', { key: point.knowledgePointId }, `${point.title} · ${point.knowledgePointId}`),
            ),
          ),
        )
      }
    } else {
      body.push(
        React.createElement('p', { key: 'count' }, `命中 ${payload.segments.length} 个片段`),
        ...payload.segments.map((segment: Segment) =>
          React.createElement('button', {
            key: segment.segmentId,
            type: 'button',
            onClick: () => {
              setError(undefined)
              void reportCitationClick(segment.segmentId)
              void openSegment({
                segmentId: segment.segmentId,
                courseId: segment.courseId,
                courseTitle: segment.courseTitle,
                chapterId: segment.chapterId,
                chapterTitle: segment.chapterTitle,
                knowledgePointId: segment.knowledgePointId,
                knowledgePointTitle: segment.knowledgePointTitle,
                title: segment.title,
                startSec: segment.startSec,
                endSec: segment.endSec,
              }).catch((openError: unknown) => {
                console.error('[trend-coach] open segment failed', openError)
                setError('打开播放器失败，请稍后重试')
              })
            },
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderTop: '1px solid #ddd',
              background: 'transparent',
              padding: '6px 0',
              cursor: 'pointer',
              font: 'inherit',
            },
          },
          React.createElement('div', null, `[${segment.segmentId}] ${segment.title}`),
          React.createElement('div', { style: { color: '#666', fontSize: 12 } },
            `${displayTitle(segment.courseTitle, segment.courseId)} / `
            + `${displayTitle(segment.chapterTitle, segment.chapterId)} / `
            + `${displayTitle(segment.knowledgePointTitle, segment.knowledgePointId)}`
            + ` · ${segment.startSec}s-${segment.endSec}s · 相关度 ${segment.score.toFixed(3)}`,
          ),
        ),
        ),
      )
    }
  }

  const authLine = auth === undefined
    ? '授权状态读取中…'
    : auth.authorized
      ? auth.mode === 'device'
        ? `已授权（设备 ${auth.deviceId ?? '未知'}）`
        : '已授权（本地凭据）'
      : '未授权，请先完成设备登录'

  const authBlock = React.createElement(
    'div',
    { style: { border: '1px solid #ddd', borderRadius: 4, padding: '6px 8px', marginBottom: 8 } },
    React.createElement('div', null, authLine),
    device === undefined
      ? null
      : React.createElement('div', { style: { marginTop: 6 } },
        React.createElement('div', null, '在浏览器打开下方地址，输入设备码完成授权：'),
        React.createElement('a', {
          href: device.verificationUri,
          target: '_blank',
          rel: 'noreferrer',
          style: { wordBreak: 'break-all' },
        }, device.verificationUri),
        React.createElement('div', null,
          '设备码：',
          React.createElement('code', { style: { fontSize: 15, fontWeight: 600, letterSpacing: 2 } }, device.userCode),
        ),
        React.createElement('div', { style: { color: '#666' } }, '等待授权中…'),
      ),
    React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
      device === undefined
        ? React.createElement('button', {
          type: 'button',
          disabled: authBusy,
          onClick: () => void login(),
        }, authBusy ? '处理中…' : auth?.authorized === true ? '重新设备登录' : '设备登录')
        : null,
      auth?.authorized === true && device === undefined
        ? React.createElement('button', {
          type: 'button',
          disabled: authBusy,
          onClick: () => void logout(),
        }, '退出并注销')
        : null,
    ),
    authError !== undefined
      ? React.createElement('p', { style: { margin: '6px 0 0', color: '#c0392b' } }, authError)
      : null,
  )

  const consentBlock = authorized
    ? React.createElement(
      'div',
      { style: { border: '1px solid #ddd', borderRadius: 4, padding: '6px 8px', marginBottom: 8 } },
      React.createElement(
        'label',
        { style: { display: 'flex', gap: 6, alignItems: 'flex-start' } },
        React.createElement('input', {
          type: 'checkbox',
          checked: consent === true,
          disabled: consentBusy || consent === undefined,
          onChange: () => void toggleConsent(),
        }),
        React.createElement('span', null,
          '允许匿名上报使用指标（检索、引用、播放；不含问题与回答内容）'),
      ),
      consentError !== undefined
        ? React.createElement('p', { style: { margin: '6px 0 0', color: '#c0392b' } }, consentError)
        : null,
    )
    : null

  return React.createElement(
    'div',
    { style: { padding: 12, fontSize: 13, lineHeight: 1.5 } },
    React.createElement('h3', { style: { margin: '0 0 8px' } }, '趋势伴学'),
    authBlock,
    consentBlock,
    React.createElement('div', { style: { display: 'flex', gap: 6 } },
      React.createElement('input', {
        value: query,
        maxLength: MAX_QUERY_LENGTH,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
        style: { flex: 1, padding: '4px 6px' },
      }),
      React.createElement('button', { disabled: busy, onClick: () => void run() }, busy ? '检索中…' : '检索'),
    ),
    ...body,
    React.createElement('p', { key: 'disclaimer', style: { margin: '10px 0 0', color: '#888', fontSize: 12 } }, DISCLAIMER),
  )
}

function isHlsSource(src: string): boolean {
  return /\.m3u8(?:$|\?)/i.test(src)
}

function Player({ useTabInfo, reportPlayerStarted, reportProgress }: PlayerProps): React.ReactElement {
  const info = useTabInfo === undefined ? undefined : useTabInfo()
  const navigation = info?.tab.navigation
  const params = (navigation?.params ?? {}) as PlayerParams
  const revision = navigation?.revision ?? 0
  const startSec = typeof params.startSec === 'number' ? params.startSec : undefined
  const endSec = typeof params.endSec === 'number' ? params.endSec : undefined
  const knowledgePointId = typeof params.knowledgePointId === 'string' && params.knowledgePointId.length > 0
    ? params.knowledgePointId
    : undefined
  const src = params.src

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const startedAtRef = React.useRef(Date.now())
  const reportedRef = React.useRef<string | undefined>(undefined)
  const gestureRef = React.useRef(false)
  const watchedRef = React.useRef(0)
  const lastTimeRef = React.useRef<number | undefined>(undefined)
  const reportedSecRef = React.useRef(0)
  const completedRef = React.useRef(false)
  const reportedCompletedRef = React.useRef(false)
  const [current, setCurrent] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [ready, setReady] = React.useState(false)
  const [needsGesture, setNeedsGesture] = React.useState(false)
  const [pausedAtClip, setPausedAtClip] = React.useState(false)
  const [mediaError, setMediaError] = React.useState<string | undefined>(params.error)

  const clipEnd = startSec === undefined
    ? undefined
    : Math.min(endSec ?? startSec + SEGMENT_CLIP_SEC, startSec + SEGMENT_CLIP_SEC)
  const progressKey = `${knowledgePointId ?? ''}#${revision}#${src ?? ''}`

  const segmentId = params.segmentId
  const scene = React.useMemo(() => (
    segmentId === undefined || params.courseId === undefined
      ? undefined
      : {
        courseId: params.courseId,
        ...(params.courseTitle === undefined ? {} : { courseTitle: params.courseTitle }),
        ...(params.chapterId === undefined ? {} : { chapterId: params.chapterId }),
        ...(params.chapterTitle === undefined ? {} : { chapterTitle: params.chapterTitle }),
        ...(knowledgePointId === undefined ? {} : { knowledgePointId }),
        ...(params.knowledgePointTitle === undefined ? {} : { knowledgePointTitle: params.knowledgePointTitle }),
        segmentId,
      }
  ), [
    segmentId,
    params.courseId,
    params.courseTitle,
    params.chapterId,
    params.chapterTitle,
    params.knowledgePointTitle,
    knowledgePointId,
  ])

  // 打开播放器本身就是一次有意的导航；播放位置只在当前场景仍是该片段时更新。
  const activateScene = React.useCallback((positionSec?: number) => {
    if (scene === undefined) return
    learnerContextStore.setScene(positionSec === undefined ? scene : { ...scene, positionSec })
  }, [scene])

  // 进度是业务写入，失败不影响播放；30 秒节流，暂停/结束/片段播完时强制上报。
  const flushProgress = React.useCallback((completed: boolean, force = false) => {
    if (knowledgePointId === undefined) return
    if (completed) completedRef.current = true
    const watchedSec = Math.floor(watchedRef.current)
    if (watchedSec === 0 && !completedRef.current) return
    if (!force && watchedSec - reportedSecRef.current < 30 && !completedRef.current) return
    if (watchedSec === reportedSecRef.current && completedRef.current === reportedCompletedRef.current) return
    reportedSecRef.current = watchedSec
    reportedCompletedRef.current = completedRef.current
    try {
      const pending = reportProgress?.(knowledgePointId, watchedSec, completedRef.current)
      if (pending !== undefined) void pending.catch(() => undefined)
    } catch {
      // 进度上报失败只影响进度，不影响播放。
    }
  }, [knowledgePointId, reportProgress])
  const flushRef = React.useRef(flushProgress)
  flushRef.current = flushProgress

  React.useEffect(() => {
    setPausedAtClip(false)
    setNeedsGesture(false)
    setDuration(0)
    setMediaError(params.error)
    startedAtRef.current = Date.now()
    reportedRef.current = undefined
    gestureRef.current = false
    watchedRef.current = 0
    lastTimeRef.current = undefined
    reportedSecRef.current = 0
    completedRef.current = false
    reportedCompletedRef.current = false
  }, [startSec, revision, src, params.error])

  React.useEffect(() => () => flushRef.current(false, true), [progressKey])

  React.useEffect(() => {
    const video = videoRef.current
    if (video === null || src === undefined || !isHlsSource(src)) return

    // Chrome on macOS answers "maybe" for native HLS without actually playing it,
    // so only fall back to the native pipeline when hls.js has no MSE support.
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl') === '') {
        setMediaError('当前环境不支持 HLS 播放')
        return
      }
      video.src = src
      return
    }

    const hls = new Hls({ enableWorker: false })
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      setMediaError(data.type === Hls.ErrorTypes.NETWORK_ERROR ? '播放地址无效或已过期' : '视频解密或解码失败')
    })
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => setReady(true))
    return () => hls.destroy()
  }, [src])

  React.useEffect(() => {
    const video = videoRef.current
    if (video === null || startSec === undefined) return
    const seek = () => {
      try {
        video.currentTime = startSec
      } catch {
        // metadata still loading
      }
      void video.play().then(() => {
        setNeedsGesture(false)
      }).catch(() => {
        gestureRef.current = true
        setNeedsGesture(true)
      })
    }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [startSec, revision, src])

  const onTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget
    const now = video.currentTime
    const previous = lastTimeRef.current
    lastTimeRef.current = now
    if (!video.paused && previous !== undefined && now > previous) {
      const delta = now - previous
      // 跳转或倍速造成的突变不计入观看时长。
      if (delta < 2) watchedRef.current += delta
    }
    setCurrent(now)
    if (segmentId !== undefined) learnerContextStore.updatePosition(segmentId, now)
    if (!video.paused && watchedRef.current - reportedSecRef.current >= 30) {
      flushProgress(false)
    }
    if (clipEnd !== undefined && !video.paused && now >= clipEnd) {
      video.pause()
      setPausedAtClip(true)
      flushProgress(true, true)
    }
  }

  const onMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    setReady(true)
    const value = event.currentTarget.duration
    if (Number.isFinite(value) && value > 0) setDuration(value)
    activateScene(startSec ?? event.currentTarget.currentTime)
  }

  const onPlaying = () => {
    activateScene(videoRef.current?.currentTime ?? startSec ?? 0)
    const key = `${src ?? ''}#${revision}`
    if (reportedRef.current === key) return
    reportedRef.current = key
    reportPlayerStarted?.(Math.max(0, Date.now() - startedAtRef.current), gestureRef.current)
  }

  const onSeeking = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    activateScene(event.currentTarget.currentTime)
  }

  const onPause = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (segmentId !== undefined) {
      learnerContextStore.updatePosition(segmentId, event.currentTarget.currentTime)
    }
    flushProgress(false, true)
  }

  const onEnded = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (segmentId !== undefined) {
      learnerContextStore.updatePosition(segmentId, event.currentTarget.currentTime)
    }
    flushProgress(true, true)
  }

  const range = startSec !== undefined && endSec !== undefined
    ? `片段 ${startSec}s – ${endSec}s`
    : startSec !== undefined ? `定位 ${startSec}s` : '未指定片段'

  if (src === undefined) {
    return React.createElement(
      'div',
      { style: { padding: 12, fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 8 } },
      React.createElement('h3', { style: { margin: 0 } }, params.title ?? params.segmentId ?? '课程视频'),
      React.createElement('p', { style: { margin: 0, color: '#c0392b' } }, mediaError ?? '缺少播放地址'),
      React.createElement('p', { style: { margin: 0, color: '#888', fontSize: 12 } }, DISCLAIMER),
    )
  }

  const watermark = params.watermark ?? 'trend-coach'
  const corner = Math.floor(current / 15) % 4
  const clampPercent = (value: number) => Math.min(100, Math.max(0, (value / duration) * 100))
  const highlight = startSec !== undefined && endSec !== undefined && duration > 0
    ? React.createElement(React.Fragment, null,
      React.createElement('div', {
        style: {
          position: 'relative',
          height: 8,
          background: '#e0e0e0',
          borderRadius: 4,
          overflow: 'hidden',
        },
      },
      React.createElement('div', {
        style: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${clampPercent(startSec)}%`,
          width: `${Math.max(0, clampPercent(endSec) - clampPercent(startSec))}%`,
          background: '#f0b429',
        },
      }),
      React.createElement('div', {
        style: {
          position: 'absolute',
          top: -1,
          bottom: -1,
          width: 2,
          left: `${clampPercent(current)}%`,
          background: '#c0392b',
        },
      })),
      React.createElement('p', { style: { margin: 0, color: '#666' } },
        `高亮区间 ${startSec}s – ${endSec}s，当前 ${current.toFixed(1)}s`),
    )
    : null
  const watermarkStyle: React.CSSProperties = {
    position: 'absolute',
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
    pointerEvents: 'none',
    ...(corner === 0 ? { top: 10, left: 10 } : {}),
    ...(corner === 1 ? { top: 10, right: 10 } : {}),
    ...(corner === 2 ? { bottom: 44, right: 10 } : {}),
    ...(corner === 3 ? { bottom: 44, left: 10 } : {}),
  }

  return React.createElement(
    'div',
    { style: { padding: 12, fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('h3', { style: { margin: 0 } }, params.title ?? params.segmentId ?? '课程视频'),
    React.createElement('p', { style: { margin: 0, color: '#666' } }, range),
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('video', {
        ref: videoRef,
        src: isHlsSource(src) ? undefined : src,
        controls: true,
        preload: 'metadata',
        style: { width: '100%', background: '#000' },
        onLoadedMetadata: onMetadata,
        onDurationChange: onMetadata,
        onPlaying,
        onSeeking,
        onTimeUpdate,
        onPause,
        onEnded,
        onError: () => setMediaError('视频加载失败'),
      }),
      React.createElement('div', { style: watermarkStyle }, `${watermark} · ${Math.floor(current)}s`),
    ),
    highlight,
    needsGesture || pausedAtClip
      ? React.createElement('button', {
        type: 'button',
        onClick: () => {
          setPausedAtClip(false)
          void videoRef.current?.play().then(() => setNeedsGesture(false)).catch(() => {
            gestureRef.current = true
            setNeedsGesture(true)
          })
        },
      }, pausedAtClip ? '片段已播放完毕，继续播放' : '点击播放')
      : null,
    mediaError !== undefined
      ? React.createElement('p', { style: { margin: 0, color: '#c0392b' } }, mediaError)
      : null,
    React.createElement('p', { style: { margin: 0, color: '#666' } },
      ready ? `当前播放位置 ${current.toFixed(1)}s` : '视频加载中…'),
    React.createElement('p', { key: 'disclaimer', style: { margin: 0, color: '#888', fontSize: 12 } }, DISCLAIMER),
  )
}

function parseCitation(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.hostname !== CITATION_HOST || !url.pathname.startsWith('/segment/')) return undefined
  const segmentId = decodeURIComponent(url.pathname.slice('/segment/'.length))
  return SEGMENT_CODE.test(segmentId) ? segmentId : undefined
}

export function apply(ctx: Context): void {
  ;(globalThis as Record<string, unknown>).__TREND_COACH_CLIENT__ = true
  console.debug('[trend-coach] client plugin loaded')

  const openPlayer = (params: PlayerParams) => {
    try {
      ctx.sidebarRight.openTab(PLAYER_KIND, { params: { ...params } })
    } catch (error) {
      console.error('[trend-coach] open player tab failed', error)
    }
  }

  const openSegment = async (remote: TrendCoachRemote, params: PlayerParams): Promise<void> => {
    if (params.segmentId === undefined) {
      openPlayer({ ...params, error: '缺少引用片段' })
      return
    }
    const session: RemotePlaybackResult = await remote.createPlaybackSession(params.segmentId)
    if (!session.ok) {
      console.error('[trend-coach] createPlaybackSession failed', session.error)
      openPlayer({ ...params, error: '播放地址获取失败，请稍后重试' })
      return
    }
    const value: PlaybackSession = session.value
    openPlayer({
      ...params,
      src: value.playlistUrl,
      watermark: value.watermark?.label,
    })
  }

  const openCitation = async (remote: TrendCoachRemote, segmentId: string): Promise<void> => {
    void remote.reportCitationClick(segmentId)
    await openSegmentById(remote, segmentId, {})
  }

  // 体系页只拿到 segmentId，起止秒必须回到 getSegment 取权威值。
  const openKnowledgePointSegment = async (
    remote: TrendCoachRemote,
    segmentId: string,
    knowledgePointId: string,
    title: string,
  ): Promise<void> => {
    await openSegmentById(remote, segmentId, { knowledgePointId, knowledgePointTitle: title, title })
  }

  const openSegmentById = async (
    remote: TrendCoachRemote,
    segmentId: string,
    extra: { knowledgePointId?: string; knowledgePointTitle?: string; title?: string },
  ): Promise<void> => {
    const result = await remote.getSegment(segmentId)
    if (!result.ok) {
      console.error('[trend-coach] getSegment failed', result.error)
      openPlayer({ segmentId, ...extra, error: '引用片段不可用，可能已下架' })
      return
    }
    const segment = result.value
    await openSegment(remote, {
      segmentId: segment.segmentId,
      courseId: segment.courseId,
      courseTitle: segment.courseTitle,
      chapterId: segment.chapterId,
      chapterTitle: segment.chapterTitle,
      knowledgePointId: extra.knowledgePointId ?? segment.knowledgePointId,
      knowledgePointTitle: extra.knowledgePointTitle ?? segment.knowledgePointTitle,
      title: extra.title ?? segment.title,
      startSec: segment.startSec,
      endSec: segment.endSec,
    })
  }

  const info = createTypertRemoteInfo(spec, z)

  ctx.effect(() => {
    const mounting = ctx.remote.$mount(info)
    mounting.then(() => {
      console.info('[trend-coach] remote mounted')
      ctx.inject(['remote.trendCoach'], (scoped) => {
        scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          inject: () => ({
            search: (query: string) => scoped.remote.trendCoach.search(query, 5),
            openSegment: (params: PlayerParams) => openSegment(scoped.remote.trendCoach, params),
            authStatus: () => scoped.remote.trendCoach.authStatus(),
            beginDeviceAuth: () => scoped.remote.trendCoach.beginDeviceAuth(),
            pollDeviceAuth: () => scoped.remote.trendCoach.pollDeviceAuth(),
            eventConsent: () => scoped.remote.trendCoach.eventConsent(),
            setEventConsent: (consent: boolean) => scoped.remote.trendCoach.setEventConsent(consent),
            reportCitationClick: (segmentId: string) => scoped.remote.trendCoach.reportCitationClick(segmentId),
            signOut: () => scoped.remote.trendCoach.signOut(),
          }),
        }, Panel))

        scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
          name: 'sidebar.right.pane.tab',
          key: CATALOG_ID,
          inject: () => ({
            authStatus: () => scoped.remote.trendCoach.authStatus(),
            beginDeviceAuth: () => scoped.remote.trendCoach.beginDeviceAuth(),
            pollDeviceAuth: () => scoped.remote.trendCoach.pollDeviceAuth(),
            catalogCourses: () => scoped.remote.trendCoach.catalogCourses(),
            catalogCourse: (courseId: string) => scoped.remote.trendCoach.catalogCourse(courseId),
            catalogChapter: (courseId: string, chapterId: string) =>
              scoped.remote.trendCoach.catalogChapter(courseId, chapterId),
            knowledgePoint: (knowledgePointId: string) =>
              scoped.remote.trendCoach.knowledgePoint(knowledgePointId),
            openSegment: (target: { segmentId: string; knowledgePointId?: string; title?: string }) =>
              openKnowledgePointSegment(
                scoped.remote.trendCoach,
                target.segmentId,
                target.knowledgePointId ?? '',
                target.title ?? '',
              ),
          }),
        }, CatalogPanel))

        scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PLAYER_ID,
          inject: () => ({
            reportPlayerStarted: (startupMs: number, autoplayBlocked: boolean) => {
              void scoped.remote.trendCoach.reportPlayerStarted(startupMs, autoplayBlocked)
            },
            reportProgress: (knowledgePointId: string, watchedSec: number, completed: boolean) =>
              scoped.remote.trendCoach.reportProgress(knowledgePointId, watchedSec, completed),
          }),
        }, Player))

        scoped.effect(() => {
          const onClick = (event: MouseEvent) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element)) return

            const anchor = target.closest('a[href]')
            if (anchor instanceof HTMLAnchorElement) {
              const segmentId = parseCitation(anchor.href)
              if (segmentId !== undefined) {
                event.preventDefault()
                event.stopPropagation()
                void openCitation(scoped.remote.trendCoach, segmentId)
              }
              return
            }

            const code = target.closest('code')
            const segmentId = code?.textContent?.trim()
            if (segmentId === undefined || !SEGMENT_CODE.test(segmentId)) return
            event.preventDefault()
            event.stopPropagation()
            void openCitation(scoped.remote.trendCoach, segmentId)
          }
          document.addEventListener('click', onClick, true)
          return () => document.removeEventListener('click', onClick, true)
        }, 'trend-coach citation links')

        scoped.slots.inject('conversation.input.left', () => scoped.slots.register(
          { name: 'conversation.input.left', id: 'trend-coach-context', order: 100, label: '课程上下文' },
          (props: { sessionId: string }) => React.createElement(LearnerContextBridge, {
            sessionId: props.sessionId,
            remote: scoped.remote.trendCoach,
          }),
        ))

        scoped.slots.inject('conversation.input.right', () => scoped.slots.register(
          { name: 'conversation.input.right', id: 'trend-coach-voice', order: 100, label: '语音输入' },
          (props: { sessionId: string; inputActions?: ComposerInputActions }) =>
            React.createElement(VoiceButton, {
              ownerId: props.sessionId,
              inputActions: props.inputActions,
              remote: scoped.remote.trendCoach,
            }),
        ))
      })
    }).catch((error: unknown) => {
      console.error('[trend-coach] remote mount failed', error)
    })
    return async () => {
      const dispose = await mounting
      await dispose()
    }
  }, 'trend-coach remote mount')

  ctx.effect(() => installSelectionDetector(), 'trend-coach selection')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: 'trend-coach',
    title: () => '趋势伴学',
    guide: [{
      id: TAB_ID,
      order: 200,
      title: () => '趋势伴学',
      description: () => '课程问答与视频溯源',
    }],
  }), 'trend-coach tab type')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: CATALOG_ID,
    kind: CATALOG_KIND,
    title: () => '课程体系',
    guide: [{
      id: CATALOG_ID,
      order: 190,
      title: () => '课程体系',
      description: () => '课程结构、知识点文章与学习进度',
    }],
  }), 'trend-coach catalog tab type')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLAYER_ID,
    kind: PLAYER_KIND,
    title: () => '课程视频',
    guide: [{
      id: PLAYER_ID,
      order: 210,
      title: () => '课程视频',
      description: () => '引用定位与播放',
    }],
  }), 'trend-coach player tab type')

}
