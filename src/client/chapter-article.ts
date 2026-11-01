import type { ChapterFigure } from '../shared/contracts.js'

/** 签名 URL 默认 10 分钟有效，缓存 8 分钟主动换新。 */
export const CHAPTER_ARTICLE_CACHE_TTL_MS = 8 * 60 * 1000

const FIGURE_BLOCK = /^!\[([^\]\n]*)\]\(figure:([A-Za-z0-9._-]{1,64})\)$/
const ANY_IMAGE_BLOCK = /^!\[[^\]\n]*\]\([^)\n]*\)$/

export interface FigureRef {
  figureId: string
  alt: string
}

export type FigureResolution =
  | { kind: 'figure'; figureId: string; alt: string; figure: ChapterFigure }
  | { kind: 'placeholder'; alt: string }

/** 独立成行的图片块；非 `figure:` 写法返回 invalid，交由调用方降级为普通文本。 */
export function parseFigureBlock(line: string): FigureRef | 'invalid' | undefined {
  const trimmed = line.trim()
  if (!ANY_IMAGE_BLOCK.test(trimmed)) return undefined
  const match = FIGURE_BLOCK.exec(trimmed)
  if (match === null) return 'invalid'
  const figureId = match[2]
  if (figureId === undefined) return 'invalid'
  return { figureId, alt: (match[1] ?? '').trim() }
}

/** 只用响应里的 figures 映射解析，绝不为正文中的任意 URL 生成图片请求。 */
export function resolveFigure(
  ref: FigureRef,
  figures: Record<string, ChapterFigure>,
): FigureResolution {
  const figure = Object.prototype.hasOwnProperty.call(figures, ref.figureId)
    ? figures[ref.figureId]
    : undefined
  if (figure === undefined) return { kind: 'placeholder', alt: ref.alt }
  return { kind: 'figure', figureId: ref.figureId, alt: ref.alt, figure }
}

/** 纵深防御：Host 已校验，客户端仍只渲染 http(s) 且不带凭据的地址。 */
export function isRenderableFigureUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  return url.username === '' && url.password === ''
}

export function isChapterCacheFresh(fetchedAt: number, now = Date.now()): boolean {
  const age = now - fetchedAt
  return age >= 0 && age < CHAPTER_ARTICLE_CACHE_TTL_MS
}

export function figureCaption(figure: ChapterFigure, alt: string): string {
  const caption = figure.caption?.trim() ?? ''
  if (caption.length > 0) return caption
  return alt.trim().length > 0 ? alt.trim() : figure.alt
}
