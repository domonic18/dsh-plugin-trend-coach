import * as React from 'react'
import {
  voiceController,
  type ComposerInputActions,
  type VoiceRemote,
} from './controller.js'

export interface VoiceButtonProps {
  ownerId: string
  inputActions?: ComposerInputActions
  remote: VoiceRemote
}

const baseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  border: '1px solid #d0d0d0',
  borderRadius: 4,
  background: '#fff',
  color: '#333',
  font: '12px/1 system-ui, sans-serif',
  cursor: 'pointer',
}

const recordingStyle: React.CSSProperties = {
  ...baseStyle,
  borderColor: '#c0392b',
  color: '#c0392b',
}

const pendingStyle: React.CSSProperties = {
  ...baseStyle,
  borderColor: '#2a6ebb',
  color: '#2a6ebb',
}

const disabledStyle: React.CSSProperties = {
  ...baseStyle,
  cursor: 'not-allowed',
  opacity: 0.55,
}

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function MicIcon(): React.ReactElement {
  return React.createElement('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  },
    React.createElement('path', { d: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' }),
    React.createElement('path', { d: 'M5 11a7 7 0 0 0 14 0' }),
    React.createElement('path', { d: 'M12 18v3' }),
  )
}

function Dot(): React.ReactElement {
  return React.createElement('span', {
    'aria-hidden': true,
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: '#c0392b',
      display: 'inline-block',
    },
  })
}

/** 录音状态是模块级单例：任一 composer 录音时，其它麦克风按钮一律禁用。 */
export function VoiceButton({ ownerId, inputActions, remote }: VoiceButtonProps): React.ReactElement {
  const state = React.useSyncExternalStore(
    voiceController.subscribe,
    voiceController.getSnapshot,
    voiceController.getSnapshot,
  )

  React.useEffect(() => () => voiceController.disposeOwner(ownerId), [ownerId])

  if (inputActions === undefined) {
    return React.createElement('button', {
      type: 'button',
      disabled: true,
      title: '当前环境不支持语音输入',
      'aria-label': '语音输入不可用',
      style: disabledStyle,
    }, MicIcon(), '语音输入')
  }

  const mine = state.ownerId === ownerId
  const startingMine = mine && state.phase === 'starting'
  const recordingMine = mine && state.phase === 'recording'
  const processingMine = mine && state.phase === 'processing'
  const pending = state.pending?.ownerId === ownerId ? state.pending : undefined
  const error = mine ? state.error : undefined
  const busyElsewhere = state.phase !== 'idle' && !mine

  let label: React.ReactNode = '语音输入'
  let title = '点击开始录音，再次点击结束；最长 60 秒'
  let style = baseStyle
  if (startingMine) {
    label = '授权麦克风…'
    title = '正在等待麦克风权限'
  } else if (recordingMine) {
    label = [React.createElement(Dot, { key: 'dot' }), `${formatTime(state.elapsedSec)} 停止`]
    title = '点击结束录音'
    style = recordingStyle
  } else if (processingMine) {
    label = '转写中…'
    title = '正在转写录音'
  } else if (pending !== undefined) {
    label = '插入转写'
    title = '把转写插入当前输入框'
    style = pendingStyle
  }

  const onClick = (): void => {
    if (pending !== undefined) {
      voiceController.insertPending(ownerId, inputActions)
      return
    }
    void voiceController.toggle(ownerId, inputActions, remote)
  }

  const disabled = busyElsewhere || processingMine || startingMine

  const children: React.ReactNode[] = [
    React.createElement('button', {
      key: 'button',
      type: 'button',
      onClick,
      disabled,
      title: busyElsewhere ? '另一个输入框正在录音' : title,
      'aria-label': title,
      'aria-pressed': recordingMine,
      style: disabled ? { ...style, cursor: 'not-allowed', opacity: 0.55 } : style,
    }, recordingMine ? null : MicIcon(), label),
  ]

  if (pending !== undefined) {
    children.push(React.createElement('button', {
      key: 'dismiss',
      type: 'button',
      title: '清除待插入的转写',
      'aria-label': '清除待插入的转写',
      onClick: () => voiceController.dismissPending(ownerId),
      style: { ...baseStyle, height: 20, padding: '0 4px', border: 0, color: '#888' },
    }, '×'))
  }

  if (error !== undefined) {
    children.push(React.createElement('span', {
      key: 'error',
      role: 'alert',
      style: { color: '#c0392b', fontSize: 12 },
    }, error))
  }

  return React.createElement('div', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  }, ...children)
}
