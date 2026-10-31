const COMPOSER_SELECTOR = '[data-composer-input]'

export function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0
    && style?.display !== 'none' && style?.visibility !== 'hidden'
}

/** 打开多个 pane 时不做猜测：只有唯一可见 composer 或明确偏好时才聚焦。 */
export function focusComposer(preferred?: HTMLElement): void {
  if (typeof document === 'undefined') return
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR))
    .filter(isVisible)
  const target = preferred !== undefined && candidates.includes(preferred)
    ? preferred
    : candidates.length === 1 ? candidates[0] : undefined
  try {
    target?.focus()
  } catch {
    // 聚焦失败不阻断上下文携带，用户可手动点击输入框。
  }
}
