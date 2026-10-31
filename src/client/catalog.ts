import * as React from 'react'
import type {
  AuthStatus,
  CatalogCourse,
  CatalogCourseSummary,
  DeviceAuthStart,
  KnowledgePointDetail,
} from '../shared/contracts.js'
import type {
  RemoteAuthStatusResult,
  RemoteCatalogCourseResult,
  RemoteCatalogCoursesResult,
  RemoteDeviceAuthPollResult,
  RemoteDeviceAuthStartResult,
  RemoteKnowledgePointResult,
} from './dsh.js'
import { learnerContextStore } from './learner-context.js'

export interface CatalogOpenTarget {
  segmentId: string
  knowledgePointId?: string
  title?: string
}

export interface CatalogPanelProps {
  authStatus: () => Promise<RemoteAuthStatusResult>
  beginDeviceAuth: () => Promise<RemoteDeviceAuthStartResult>
  pollDeviceAuth: () => Promise<RemoteDeviceAuthPollResult>
  catalogCourses: () => Promise<RemoteCatalogCoursesResult>
  catalogCourse: (courseId: string) => Promise<RemoteCatalogCourseResult>
  knowledgePoint: (knowledgePointId: string) => Promise<RemoteKnowledgePointResult>
  openSegment: (target: CatalogOpenTarget) => Promise<void>
}

interface CatalogCache {
  courses?: CatalogCourseSummary[]
  course?: CatalogCourse
  point?: KnowledgePointDetail
}

// 切换右栏 tab 会重建面板；保留课程树与当前阅读位置。
const cache: CatalogCache = {}

interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'hr'
  level?: number
  ordered?: boolean
  text?: string
  items?: string[]
}

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g
const LINK_TOKEN = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/

function safeHref(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw, 'https://trend-coach.local/')
  } catch {
    return undefined
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let index = 0
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const token = match[0]
    const at = match.index ?? 0
    if (at > last) nodes.push(text.slice(last, at))
    const key = `${keyPrefix}-i${index++}`
    if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(React.createElement('strong', { key }, token.slice(2, -2)))
    } else if (token.startsWith('`')) {
      nodes.push(React.createElement('code', { key }, token.slice(1, -1)))
    } else if (token.startsWith('[')) {
      const link = LINK_TOKEN.exec(token)
      const href = link === null ? undefined : safeHref(link[2])
      if (link === null || href === undefined) {
        nodes.push(token)
      } else {
        nodes.push(React.createElement('a', {
          key,
          href,
          target: '_blank',
          rel: 'noreferrer noopener',
        }, link[1]))
      }
    } else {
      nodes.push(React.createElement('em', { key }, token.slice(1, -1)))
    }
    last = at + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

// 只解析 Markdown 子集并生成 React 元素；不执行 HTML/脚本，不使用 innerHTML。
function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  let fence: string[] | undefined

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  for (const line of lines) {
    if (fence !== undefined) {
      if (/^\s*```\s*$/.test(line)) {
        blocks.push({ type: 'code', text: fence.join('\n') })
        fence = undefined
      } else {
        fence.push(line)
      }
      continue
    }
    if (/^\s*```/.test(line)) {
      flushParagraph()
      fence = []
      continue
    }
    if (/^\s*$/.test(line)) {
      flushParagraph()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushParagraph()
      blocks.push({ type: 'hr' })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote !== null) {
      flushParagraph()
      blocks.push({ type: 'quote', text: quote[1] })
      continue
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (unordered !== null || ordered !== null) {
      flushParagraph()
      const previous = blocks[blocks.length - 1]
      const item = (unordered ?? ordered)?.[1] ?? ''
      const wantsOrdered = ordered !== null
      if (previous?.type === 'list' && previous.ordered === wantsOrdered) {
        previous.items?.push(item)
      } else {
        blocks.push({ type: 'list', ordered: wantsOrdered, items: [item] })
      }
      continue
    }
    paragraph.push(line.trim())
  }
  if (fence !== undefined) blocks.push({ type: 'code', text: fence.join('\n') })
  flushParagraph()
  return blocks
}

const HEADING_TAGS = ['h1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const

function renderBlock(block: MarkdownBlock, index: number): React.ReactElement {
  const key = `b${index}`
  switch (block.type) {
    case 'heading': {
      const tag = HEADING_TAGS[Math.min(Math.max(block.level ?? 2, 1), 6)]
      return React.createElement(tag, {
        key,
        style: { margin: '12px 0 6px', fontSize: tag === 'h1' ? 18 : tag === 'h2' ? 16 : 14 },
      }, ...renderInline(block.text ?? '', key))
    }
    case 'list':
      return React.createElement(
        block.ordered === true ? 'ol' : 'ul',
        { key, style: { margin: '6px 0', paddingLeft: 20 } },
        ...(block.items ?? []).map((item, itemIndex) =>
          React.createElement('li', { key: `${key}-l${itemIndex}` }, ...renderInline(item, `${key}-l${itemIndex}`)),
        ),
      )
    case 'quote':
      return React.createElement('blockquote', {
        key,
        style: {
          margin: '6px 0',
          padding: '2px 10px',
          borderLeft: '3px solid #ccc',
          color: '#555',
        },
      }, ...renderInline(block.text ?? '', key))
    case 'code':
      return React.createElement('pre', {
        key,
        style: { margin: '6px 0', padding: 8, background: '#f5f5f5', borderRadius: 4, overflowX: 'auto' },
      }, React.createElement('code', null, block.text ?? ''))
    case 'hr':
      return React.createElement('hr', { key, style: { border: 0, borderTop: '1px solid #ddd', margin: '10px 0' } })
    default:
      return React.createElement('p', { key, style: { margin: '6px 0' } },
        ...renderInline(block.text ?? '', key))
  }
}

function Markdown({ markdown }: { markdown: string }): React.ReactElement {
  const blocks = React.useMemo(() => parseMarkdown(markdown), [markdown])
  return React.createElement('div', { style: { lineHeight: 1.7 } },
    ...blocks.map(renderBlock))
}

function formatSeconds(value: number): string {
  const total = Math.max(0, Math.floor(value))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDate(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buttonStyle(): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    border: 0,
    borderTop: '1px solid #e5e5e5',
    background: 'transparent',
    padding: '7px 0',
    cursor: 'pointer',
    font: 'inherit',
  }
}

export function CatalogPanel({
  authStatus,
  beginDeviceAuth,
  pollDeviceAuth,
  catalogCourses,
  catalogCourse,
  knowledgePoint,
  openSegment,
}: CatalogPanelProps): React.ReactElement {
  const [auth, setAuth] = React.useState<AuthStatus | undefined>(undefined)
  const [device, setDevice] = React.useState<DeviceAuthStart | undefined>(undefined)
  const [authBusy, setAuthBusy] = React.useState(false)
  const [authError, setAuthError] = React.useState<string | undefined>(undefined)

  const [courses, setCourses] = React.useState<CatalogCourseSummary[] | undefined>(() => cache.courses)
  const [course, setCourse] = React.useState<CatalogCourse | undefined>(() => cache.course)
  const [point, setPoint] = React.useState<KnowledgePointDetail | undefined>(() => cache.point)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)

  const authorized = auth?.authorized === true

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = await authStatus()
        if (cancelled) return
        if (result.ok) setAuth(result.value)
        else setAuthError(result.error.message)
      } catch (failure: unknown) {
        if (!cancelled) setAuthError(failure instanceof Error ? failure.message : '授权状态读取失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authStatus])

  React.useEffect(() => {
    if (!authorized) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const result = await catalogCourses()
        if (cancelled) return
        if (result.ok) {
          cache.courses = result.value.courses
          setCourses(result.value.courses)
          setError(undefined)
        } else {
          setError(result.error.message)
        }
      } catch (failure: unknown) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '课程列表读取失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authorized, catalogCourses])

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
          // 凭据落盘到 authStatus 可见之间存在短暂延迟，轮询几次避免停在未授权态。
          let settled = false
          for (let attempt = 0; attempt < 8 && !cancelled; attempt += 1) {
            try {
              const status = await authStatus()
              if (status.ok && status.value.authorized) {
                setAuth(status.value)
                settled = true
                break
              }
            } catch {
              // 继续重试。
            }
            if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 250))
          }
          if (!cancelled && !settled) {
            setAuthError('授权已完成，但本地授权状态尚未生效，请稍后重新打开面板')
          }
          return
        }
        if (result.value.status === 'expired') {
          setDevice(undefined)
          setAuthError('设备码已过期，请重新发起登录')
          return
        }
        timer = setTimeout(() => void tick(), device.interval * 1000)
      } catch (failure: unknown) {
        if (cancelled) return
        setAuthError(failure instanceof Error ? failure.message : '设备授权轮询失败')
        setDevice(undefined)
      }
    }
    timer = setTimeout(() => void tick(), device.interval * 1000)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [device, pollDeviceAuth, authStatus])

  const login = async () => {
    setAuthBusy(true)
    setAuthError(undefined)
    try {
      const result = await beginDeviceAuth()
      if (result.ok) setDevice(result.value)
      else setAuthError(result.error.message)
    } catch (failure: unknown) {
      setAuthError(failure instanceof Error ? failure.message : '设备授权发起失败')
    }
    setAuthBusy(false)
  }

  const openCourse = async (courseId: string) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await catalogCourse(courseId)
      if (result.ok) {
        cache.course = result.value
        cache.point = undefined
        setCourse(result.value)
        setPoint(undefined)
        learnerContextStore.setScene({
          courseId: result.value.courseId,
          courseTitle: result.value.title,
        })
      } else {
        setError(result.error.message)
      }
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : '课程结构读取失败')
    }
    setLoading(false)
  }

  const openPoint = async (knowledgePointId: string) => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await knowledgePoint(knowledgePointId)
      if (result.ok) {
        cache.point = result.value
        setPoint(result.value)
        const chapter = cache.course?.chapters.find(
          (item) => item.chapterId === result.value.chapterId,
        )
        learnerContextStore.setScene({
          courseId: result.value.courseId,
          ...(cache.course?.courseId === result.value.courseId
            ? { courseTitle: cache.course.title }
            : {}),
          chapterId: result.value.chapterId,
          ...(chapter === undefined ? {} : { chapterTitle: chapter.title }),
          knowledgePointId: result.value.knowledgePointId,
          knowledgePointTitle: result.value.title,
        })
      } else {
        setError(result.error.message)
      }
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : '知识点读取失败')
    }
    setLoading(false)
  }

  const backToCourses = () => {
    cache.course = undefined
    cache.point = undefined
    setCourse(undefined)
    setPoint(undefined)
    learnerContextStore.clearScene()
  }

  const backToCourse = () => {
    cache.point = undefined
    setPoint(undefined)
    if (course !== undefined) {
      learnerContextStore.setScene({
        courseId: course.courseId,
        courseTitle: course.title,
      })
    }
  }

  const play = async (target: CatalogOpenTarget) => {
    try {
      await openSegment(target)
    } catch (openError: unknown) {
      console.error('[trend-coach] catalog open segment failed', openError)
      setError('打开播放器失败，请稍后重试')
    }
  }

  const header = React.createElement('h3', { style: { margin: '0 0 8px' } }, '课程体系')

  if (!authorized) {
    const block = auth === undefined
      ? React.createElement('p', { style: { margin: 0 } }, '授权状态读取中…')
      : React.createElement(
        'div',
        { style: { border: '1px solid #ddd', borderRadius: 4, padding: '6px 8px' } },
        React.createElement('div', null, '课程体系需要登录后查看。'),
        device === undefined
          ? React.createElement('button', {
            type: 'button',
            disabled: authBusy,
            onClick: () => void login(),
            style: { marginTop: 6 },
          }, authBusy ? '处理中…' : '设备登录')
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
        authError !== undefined
          ? React.createElement('p', { style: { margin: '6px 0 0', color: '#c0392b' } }, authError)
          : null,
      )
    return React.createElement(
      'div',
      { style: { padding: 12, fontSize: 13, lineHeight: 1.5 } },
      header,
      authError !== undefined && auth === undefined
        ? React.createElement('p', { style: { margin: '0 0 6px', color: '#c0392b' } }, authError)
        : null,
      block,
    )
  }

  const body: React.ReactNode[] = []
  if (error !== undefined) {
    body.push(React.createElement('p', { key: 'error', style: { margin: '0 0 6px', color: '#c0392b' } }, error))
  }
  if (loading) {
    body.push(React.createElement('p', { key: 'loading', style: { color: '#666' } }, '加载中…'))
  }

  if (point !== undefined) {
    body.push(
      React.createElement('button', {
        key: 'back-course',
        type: 'button',
        onClick: backToCourse,
        style: { border: 0, background: 'transparent', color: '#2a6ebb', cursor: 'pointer', padding: 0 },
      }, '← 返回课程结构'),
      React.createElement('h4', { key: 'point-title', style: { margin: '8px 0 2px' } }, point.title),
      point.article === null
        ? React.createElement('p', { key: 'no-article', style: { color: '#666' } }, '该知识点暂无文章。')
        : React.createElement(
          'div',
          { key: 'article', style: { border: '1px solid #eee', borderRadius: 4, padding: '6px 10px', marginTop: 6 } },
          React.createElement('p', { key: 'meta', style: { margin: '0 0 4px', color: '#888', fontSize: 12 } },
            `文章 v${point.article.version} · 发布于 ${formatDate(point.article.publishedAt)}`),
          React.createElement(Markdown, { key: 'markdown', markdown: point.article.markdown }),
        ),
      point.segmentId === undefined
        ? null
        : React.createElement('button', {
          key: 'play',
          type: 'button',
          onClick: () => void play({
            segmentId: point.segmentId as string,
            knowledgePointId: point.knowledgePointId,
            title: point.title,
          }),
          style: { marginTop: 8 },
        }, '播放对应视频片段'),
      point.adjacentKnowledgePoints.length === 0
        ? null
        : React.createElement('div', { key: 'adjacent', style: { marginTop: 10 } },
          React.createElement('div', { style: { color: '#666', marginBottom: 2 } }, '相邻知识点：'),
          ...point.adjacentKnowledgePoints.map((adjacent) =>
            React.createElement('button', {
              key: adjacent.knowledgePointId,
              type: 'button',
              onClick: () => void openPoint(adjacent.knowledgePointId),
              style: { ...buttonStyle(), borderTop: '1px dashed #e5e5e5' },
            }, `${adjacent.title} · ${adjacent.knowledgePointId}`),
          ),
        ),
    )
  } else if (course !== undefined) {
    body.push(
      React.createElement('button', {
        key: 'back-courses',
        type: 'button',
        onClick: backToCourses,
        style: { border: 0, background: 'transparent', color: '#2a6ebb', cursor: 'pointer', padding: 0 },
      }, '← 返回课程列表'),
      React.createElement('h4', { key: 'course-title', style: { margin: '8px 0 2px' } }, course.title),
      ...course.chapters.map((chapter) =>
        React.createElement('section', { key: chapter.chapterId, style: { marginTop: 8 } },
          React.createElement('div', { style: { fontWeight: 600, color: '#444' } }, chapter.title),
          ...chapter.knowledgePoints.map((item) =>
            React.createElement('button', {
              key: item.knowledgePointId,
              type: 'button',
              onClick: () => void openPoint(item.knowledgePointId),
              style: buttonStyle(),
            },
            React.createElement('div', null, item.title),
            React.createElement('div', { style: { color: '#888', fontSize: 12 } },
              item.completed
                ? '已完成'
                : item.watchedSec > 0 ? `已看 ${formatSeconds(item.watchedSec)}` : '未开始',
            ),
            ),
          ),
        ),
      ),
    )
  } else {
    const list = courses ?? []
    body.push(
      list.length === 0
        ? React.createElement('p', { key: 'empty', style: { color: '#666' } }, '暂无已发布课程。')
        : React.createElement('div', { key: 'courses' },
          ...list.map((item) =>
            React.createElement('button', {
              key: item.courseId,
              type: 'button',
              onClick: () => void openCourse(item.courseId),
              style: buttonStyle(),
            },
            React.createElement('div', null, item.title),
            React.createElement('div', { style: { color: '#888', fontSize: 12 } },
              `${item.chapterCount} 章 · ${item.knowledgePointCount} 个知识点 · 已完成 ${item.completedCount}/${item.knowledgePointCount}`,
            ),
            ),
          ),
        ),
    )
  }

  return React.createElement(
    'div',
    { style: { padding: 12, fontSize: 13, lineHeight: 1.5 } },
    header,
    ...body,
    React.createElement('p', { key: 'disclaimer', style: { margin: '10px 0 0', color: '#888', fontSize: 12 } },
      '课程内容仅供学习，不构成投资建议。'),
  )
}
