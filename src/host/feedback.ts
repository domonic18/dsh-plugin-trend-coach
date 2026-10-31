import type { Context } from '@deepseek-ai/cordis'
import type { EventReporter } from './events.js'

/** 只统计用过课程检索的会话；dsh 的反馈事件不携带工具来源。 */
export class CourseSessionTracker {
  private readonly sessions = new Set<string>()

  mark(sessionId: string | undefined): void {
    if (sessionId !== undefined) this.sessions.add(sessionId)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}

interface SessionEventLike {
  type: string
  data: unknown
}

/** dsh 消息反馈事件 → 云端评分；分类与备注一律不转发。 */
export function feedbackRating(event: SessionEventLike): 'up' | 'down' | undefined {
  if (event.type !== 'feedback/message-put') return undefined
  const item = (event.data as { item?: { rating?: unknown } } | null)?.item
  if (item?.rating === 'positive') return 'up'
  if (item?.rating === 'negative') return 'down'
  return undefined
}

type SessionListener = (session: { id: string }, event: SessionEventLike) => void
type DisposeListener = (session: { id: string }) => void

/**
 * dsh-session 由宿主提供，插件不重复声明依赖；这里只用到 id 与反馈事件字段。
 */
export function registerFeedbackBridge(
  ctx: Context,
  events: EventReporter,
  tracker: CourseSessionTracker,
): void {
  const on = ctx.on as unknown as (name: string, listener: SessionListener | DisposeListener) => () => void
  ctx.effect(() => {
    const offEvent = on('session/event', ((session, event) => {
      if (!tracker.has(session.id)) return
      const rating = feedbackRating(event as SessionEventLike)
      if (rating !== undefined) events.reportFeedback(rating)
    }) as SessionListener)
    const offDisposed = on('session/disposed', ((session) => {
      tracker.forget(session.id)
    }) as DisposeListener)
    return () => {
      offEvent()
      offDisposed()
    }
  }, 'trend-coach feedback bridge')
}
