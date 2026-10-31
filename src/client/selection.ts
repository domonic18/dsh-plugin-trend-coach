import { focusComposer } from './composer-focus.js'
import { learnerContextStore } from './learner-context.js'

const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[data-composer-input]',
].join(',')
const BUTTON_ATTR = 'data-trend-coach-selection'

function elementOf(node: Node | null): Element | undefined {
  if (node === null) return undefined
  return node instanceof Element ? node : node.parentElement ?? undefined
}

/** 选中文本只在启用上下文时提供悬浮入口；监听与按钮都随插件卸载清理。 */
export function installSelectionDetector(): () => void {
  const doc = document
  const view = doc.defaultView
  if (view === null) return () => undefined

  let lastComposer: HTMLElement | undefined
  let scheduled: ReturnType<typeof setTimeout> | undefined

  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = '提问'
  button.setAttribute('aria-label', '用选中文本提问')
  button.setAttribute(BUTTON_ATTR, 'ask')
  Object.assign(button.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'center',
    padding: '4px 10px',
    border: '1px solid #2a6ebb',
    borderRadius: 4,
    background: '#2a6ebb',
    color: '#fff',
    font: '12px/1.2 system-ui, sans-serif',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
  })

  const hide = (): void => {
    button.style.display = 'none'
  }

  const activeSelection = (): { selection: Selection; range: Range } | undefined => {
    if (!learnerContextStore.getSnapshot().enabled) return undefined
    const selection = doc.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined
    const range = selection.getRangeAt(0)
    if (range.collapsed) return undefined
    const anchor = elementOf(selection.anchorNode)
    const focus = elementOf(selection.focusNode)
    if (anchor !== undefined && anchor.closest(EDITABLE_SELECTOR) !== null) return undefined
    if (focus !== undefined && focus.closest(EDITABLE_SELECTOR) !== null) return undefined
    const container = elementOf(range.commonAncestorContainer)
    if (container !== undefined && container.closest(`[${BUTTON_ATTR}]`) !== null) return undefined
    if (selection.toString().trim().length === 0) return undefined
    return { selection, range }
  }

  const reposition = (): void => {
    const current = activeSelection()
    if (current === undefined) {
      hide()
      return
    }
    const rect = current.range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hide()
      return
    }
    const margin = 4
    const top = rect.top - 34
    button.style.top = `${top < margin ? rect.bottom + 6 : top}px`
    button.style.left = `${Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, doc.documentElement.clientWidth - 64),
    )}px`
    button.style.display = 'inline-flex'
  }

  const schedule = (): void => {
    if (scheduled !== undefined) return
    scheduled = setTimeout(() => {
      scheduled = undefined
      reposition()
    }, 0)
  }

  const onButtonPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const current = activeSelection()
    if (current === undefined) {
      hide()
      return
    }
    learnerContextStore.setSelectedText(current.selection.toString())
    hide()
    focusComposer(lastComposer)
  }

  const onFocusIn = (event: FocusEvent): void => {
    const element = elementOf(event.target as Node | null)
    const composer = element?.closest<HTMLElement>('[data-composer-input]')
    if (composer !== null && composer !== undefined) lastComposer = composer
  }

  const onScroll = (): void => hide()
  const onResize = (): void => hide()

  doc.addEventListener('selectionchange', schedule)
  doc.addEventListener('pointerup', schedule, true)
  doc.addEventListener('keyup', schedule, true)
  doc.addEventListener('focusin', onFocusIn, true)
  doc.addEventListener('scroll', onScroll, true)
  view.addEventListener('resize', onResize)
  button.addEventListener('pointerdown', onButtonPointerDown)

  const unsubscribe = learnerContextStore.subscribe(() => {
    if (!learnerContextStore.getSnapshot().enabled) hide()
  })

  const host = doc.body ?? doc.documentElement
  host.appendChild(button)

  return () => {
    doc.removeEventListener('selectionchange', schedule)
    doc.removeEventListener('pointerup', schedule, true)
    doc.removeEventListener('keyup', schedule, true)
    doc.removeEventListener('focusin', onFocusIn, true)
    doc.removeEventListener('scroll', onScroll, true)
    view.removeEventListener('resize', onResize)
    button.removeEventListener('pointerdown', onButtonPointerDown)
    unsubscribe()
    if (scheduled !== undefined) clearTimeout(scheduled)
    button.remove()
  }
}
