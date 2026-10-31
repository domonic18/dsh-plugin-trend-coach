import type { Context } from '@deepseek-ai/cordis'
import * as React from 'react'
import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteSpec } from '@deepseek-ai/dsh-typert-protocol/types'
import type { RemoteSearchResult, SearchPayload, SearchSegment } from './dsh.js'

export const name = 'trend-coach-client'

export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote']

const TAB_ID = 'dsh-plugin-trend-coach'
const PLAYER_ID = 'dsh-plugin-trend-coach-player'
const PLAYER_KIND = 'trend-coach-player'
const CITATION_HOST = 'trend-coach.local'
const SEGMENT_CODE = /^seg-[A-Za-z0-9._-]+$/
const DEFAULT_VIDEO = 'http://127.0.0.1:3939/media/lesson.mp4'

const segmentSchema = z.object({
  segmentId: z.string(),
  courseId: z.string(),
  chapterId: z.string(),
  knowledgePointId: z.string(),
  title: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  score: z.number(),
})

const resultSchema = z.object({
  query: z.string(),
  segments: z.array(segmentSchema),
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
  },
}

interface PlayerParams {
  segmentId?: string
  title?: string
  startSec?: number
  endSec?: number
  src?: string
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
  openSegment: (params: PlayerParams) => void
}

interface PlayerProps {
  useTabInfo?: TabInfoHook
}

function formatSegment(segment: SearchSegment): string {
  return `[${segment.segmentId}] ${segment.title} · ${segment.startSec}s-${segment.endSec}s · 相关度 ${segment.score.toFixed(3)}`
}

function Panel({ search, openSegment }: PanelProps): React.ReactElement {
  const [query, setQuery] = React.useState('趋势反转怎么判断')
  const [busy, setBusy] = React.useState(false)
  const [payload, setPayload] = React.useState<SearchPayload | undefined>(undefined)
  const [error, setError] = React.useState<string | undefined>(undefined)

  const run = async () => {
    setBusy(true)
    setError(undefined)
    const result = await search(query)
    if (result.ok) {
      setPayload(result.value)
    } else {
      setPayload(undefined)
      setError(`${result.error.code}: ${result.error.message}`)
    }
    setBusy(false)
  }

  const body: React.ReactNode[] = []
  if (error !== undefined) body.push(React.createElement('p', { key: 'error', style: { color: '#c0392b' } }, error))
  if (payload !== undefined) {
    body.push(
      React.createElement('p', { key: 'count' }, `命中 ${payload.segments.length} 个片段`),
      ...payload.segments.map((segment: SearchSegment) =>
        React.createElement('button', {
          key: segment.segmentId,
          type: 'button',
          onClick: () => openSegment({
            segmentId: segment.segmentId,
            title: segment.title,
            startSec: segment.startSec,
            endSec: segment.endSec,
          }),
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
        }, formatSegment(segment)),
      ),
    )
  }

  return React.createElement(
    'div',
    { style: { padding: 12, fontSize: 13, lineHeight: 1.5 } },
    React.createElement('h3', { style: { margin: '0 0 8px' } }, '趋势伴学'),
    React.createElement('div', { style: { display: 'flex', gap: 6 } },
      React.createElement('input', {
        value: query,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
        style: { flex: 1, padding: '4px 6px' },
      }),
      React.createElement('button', { disabled: busy, onClick: () => void run() }, busy ? '检索中…' : '检索'),
    ),
    ...body,
  )
}

function Player({ useTabInfo }: PlayerProps): React.ReactElement {
  const info = useTabInfo === undefined ? undefined : useTabInfo()
  const navigation = info?.tab.navigation
  const params = (navigation?.params ?? {}) as PlayerParams
  const revision = navigation?.revision ?? 0
  const startSec = typeof params.startSec === 'number' ? params.startSec : undefined
  const endSec = typeof params.endSec === 'number' ? params.endSec : undefined
  const src = params.src ?? DEFAULT_VIDEO

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const [current, setCurrent] = React.useState(0)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const video = videoRef.current
    if (video === null || startSec === undefined) return
    const seek = () => {
      try {
        video.currentTime = startSec
      } catch {
        // metadata still loading
      }
    }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
    return () => video.removeEventListener('loadedmetadata', seek)
  }, [startSec, revision, src])

  const range = startSec !== undefined && endSec !== undefined
    ? `片段 ${startSec}s – ${endSec}s`
    : startSec !== undefined ? `定位 ${startSec}s` : '未指定片段'

  return React.createElement(
    'div',
    { style: { padding: 12, fontSize: 13, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 8 } },
    React.createElement('h3', { style: { margin: 0 } }, params.title ?? params.segmentId ?? '课程视频'),
    React.createElement('p', { style: { margin: 0, color: '#666' } }, range),
    React.createElement('video', {
      ref: videoRef,
      src,
      controls: true,
      preload: 'metadata',
      style: { width: '100%', background: '#000' },
      onLoadedMetadata: () => setReady(true),
      onTimeUpdate: (event: React.SyntheticEvent<HTMLVideoElement>) => setCurrent(event.currentTarget.currentTime),
    }),
    React.createElement('p', { style: { margin: 0, color: '#666' } },
      ready ? `当前播放位置 ${current.toFixed(1)}s` : '视频加载中…'),
  )
}

function parseCitation(raw: string): PlayerParams | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.hostname !== CITATION_HOST || !url.pathname.startsWith('/segment/')) return undefined
  const segmentId = decodeURIComponent(url.pathname.slice('/segment/'.length))
  if (segmentId === '') return undefined
  const start = Number(url.searchParams.get('t'))
  const end = Number(url.searchParams.get('e'))
  return {
    segmentId,
    startSec: Number.isFinite(start) ? start : undefined,
    endSec: Number.isFinite(end) ? end : undefined,
  }
}

export function apply(ctx: Context): void {
  ;(globalThis as Record<string, unknown>).__TREND_COACH_CLIENT__ = true
  console.info('[trend-coach] client plugin loaded (remote spike)')

  const openSegment = (params: PlayerParams) => {
    try {
      ctx.sidebarRight.openTab(PLAYER_KIND, { params: { ...params } })
    } catch (error) {
      console.error('[trend-coach] open player tab failed', error)
    }
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
            openSegment,
          }),
        }, Panel))

        scoped.effect(() => {
          const onClick = (event: MouseEvent) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element)) return

            const anchor = target.closest('a[href]')
            if (anchor instanceof HTMLAnchorElement) {
              const citation = parseCitation(anchor.href)
              if (citation !== undefined) {
                event.preventDefault()
                event.stopPropagation()
                openSegment(citation)
              }
              return
            }

            const code = target.closest('code')
            const segmentId = code?.textContent?.trim()
            if (segmentId === undefined || !SEGMENT_CODE.test(segmentId)) return
            event.preventDefault()
            event.stopPropagation()
            void scoped.remote.trendCoach.getSegment(segmentId).then((result) => {
              if (!result.ok) {
                console.error('[trend-coach] getSegment failed', result.error)
                return
              }
              const segment = result.value
              openSegment({
                segmentId: segment.segmentId,
                title: segment.title,
                startSec: segment.startSec,
                endSec: segment.endSec,
              })
            })
          }
          document.addEventListener('click', onClick, true)
          return () => document.removeEventListener('click', onClick, true)
        }, 'trend-coach citation links')
      })
    }).catch((error: unknown) => {
      console.error('[trend-coach] remote mount failed', error)
    })
    return async () => {
      const dispose = await mounting
      await dispose()
    }
  }, 'trend-coach remote mount')

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

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLAYER_ID,
  }, Player))

}
