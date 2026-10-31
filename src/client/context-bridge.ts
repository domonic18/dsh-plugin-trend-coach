import * as React from 'react'
import type { LearnerContextUpdate } from '../shared/contracts.js'
import { buildLearnerContextUpdate } from './context-model.js'
import { learnerContextStore } from './learner-context.js'

export interface LearnerContextPublisher {
  setLearnerContext(
    sessionId: string,
    update: LearnerContextUpdate,
  ): Promise<{ ok: boolean } | undefined>
}

export interface LearnerContextBridgeProps {
  sessionId: string
  remote: LearnerContextPublisher
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: '#555',
}

const actionStyle: React.CSSProperties = {
  border: 0,
  background: 'transparent',
  color: '#2a6ebb',
  cursor: 'pointer',
  padding: '0 2px',
  font: 'inherit',
}

/** 每个会话挂载一份；场景是全局的，由这里负责发布到 Host 并按会话去重。 */
export function LearnerContextBridge({
  sessionId,
  remote,
}: LearnerContextBridgeProps): React.ReactElement {
  const state = React.useSyncExternalStore(
    learnerContextStore.subscribe,
    learnerContextStore.getSnapshot,
    learnerContextStore.getSnapshot,
  )
  const update = React.useMemo(() => buildLearnerContextUpdate(state), [state])
  const lastSentRef = React.useRef<string | undefined>(undefined)

  React.useEffect(() => {
    const key = `${sessionId}#${JSON.stringify(update)}`
    if (lastSentRef.current === key) return
    lastSentRef.current = key
    const pending = remote.setLearnerContext(sessionId, update)
    void Promise.resolve(pending).then((result) => {
      if (result !== undefined && !result.ok && lastSentRef.current === key) {
        lastSentRef.current = undefined
      }
    }).catch(() => {
      if (lastSentRef.current === key) lastSentRef.current = undefined
    })
  }, [sessionId, update, remote])

  const children: React.ReactNode[] = [
    React.createElement('button', {
      key: 'toggle',
      type: 'button',
      title: '学习上下文会随提问提供给模型；关闭后不再携带',
      onClick: () => learnerContextStore.setEnabled(!state.enabled),
      style: actionStyle,
    }, `课程上下文 · ${state.enabled ? '已开' : '已关'}`),
  ]

  if (state.enabled && state.selectedText !== undefined) {
    children.push(
      React.createElement('span', { key: 'selected', style: { color: '#666' } },
        '已引用选中文本',
        React.createElement('button', {
          type: 'button',
          'aria-label': '清除选中文本',
          title: '清除选中文本',
          onClick: () => learnerContextStore.clearSelectedText(),
          style: actionStyle,
        }, '×'),
      ),
    )
  }

  return React.createElement('div', { style: chipStyle }, ...children)
}
