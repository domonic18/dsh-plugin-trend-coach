import { MAX_VOICE_DURATION_MS } from '../../shared/contracts.js'
import { focusComposer } from '../composer-focus.js'
import type { RemoteVoiceTranscriptResult } from '../dsh.js'
import { beginRecording, type Recorder } from './recorder.js'

export interface ComposerInputActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

export interface VoiceRemote {
  transcribeVoice(audioBase64: string, durationMs: number): Promise<RemoteVoiceTranscriptResult>
}

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'processing'

export interface VoicePending {
  ownerId: string
  text: string
}

export interface VoiceState {
  phase: VoicePhase
  ownerId?: string
  elapsedSec: number
  error?: string
  pending?: VoicePending
}

interface VoiceSession {
  ownerId: string
  span: unknown
  actions: ComposerInputActions
  remote: VoiceRemote
  starting: Promise<Recorder>
  recorder?: Recorder
  startedAt: number
}

const MAX_SEC = MAX_VOICE_DURATION_MS / 1000
const IDLE: VoiceState = { phase: 'idle', elapsedSec: 0 }

let state: VoiceState = IDLE
let session: VoiceSession | undefined
let ticker: ReturnType<typeof setInterval> | undefined
let stopping = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function setState(next: VoiceState): void {
  state = next
  notify()
}

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker)
    ticker = undefined
  }
}

function startTicker(): void {
  stopTicker()
  ticker = setInterval(() => {
    const current = session
    if (current === undefined || state.phase !== 'recording') return
    const elapsedSec = Math.min(MAX_SEC, Math.floor((Date.now() - current.startedAt) / 1000))
    if (elapsedSec !== state.elapsedSec) {
      setState({ ...state, elapsedSec })
    }
    if (elapsedSec >= MAX_SEC) {
      void finish()
    }
  }, 250)
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : '语音转写失败，请稍后重试'
}

function insert(current: VoiceSession, text: string): void {
  let inserted = false
  try {
    inserted = current.actions.insertText(text, current.span)
  } catch {
    inserted = false
  }
  if (inserted) {
    setState(IDLE)
    focusComposer()
    return
  }
  setState({
    phase: 'idle',
    ownerId: current.ownerId,
    elapsedSec: 0,
    pending: { ownerId: current.ownerId, text },
  })
}

async function finish(): Promise<void> {
  const current = session
  if (current === undefined || stopping) return
  if (state.phase !== 'recording' || state.ownerId !== current.ownerId) return
  stopping = true
  stopTicker()
  setState({ phase: 'processing', ownerId: current.ownerId, elapsedSec: state.elapsedSec })
  try {
    const recorder = current.recorder ?? await current.starting
    session = undefined
    const { audioBase64, durationMs } = await recorder.stop()
    const result = await current.remote.transcribeVoice(audioBase64, durationMs)
    if (!result.ok) {
      setState({ phase: 'idle', ownerId: current.ownerId, elapsedSec: 0, error: result.error.message })
      return
    }
    insert(current, result.value.text)
  } catch (error) {
    session = undefined
    setState({ phase: 'idle', ownerId: current.ownerId, elapsedSec: 0, error: messageOf(error) })
  } finally {
    stopping = false
  }
}

async function toggle(
  ownerId: string,
  actions: ComposerInputActions,
  remote: VoiceRemote,
): Promise<void> {
  if (state.phase === 'processing' || state.phase === 'starting') return
  if (state.phase === 'recording') {
    if (state.ownerId === ownerId) await finish()
    return
  }

  let span: unknown
  try {
    span = actions.captureInsertion()
  } catch {
    span = undefined
  }

  const starting = beginRecording()
  const current: VoiceSession = { ownerId, span, actions, remote, starting, startedAt: 0 }
  session = current
  // 权限弹窗未决时不能对外宣称“正在录音”，否则停止会永远等不到麦克风。
  setState({ phase: 'starting', ownerId, elapsedSec: 0 })

  try {
    const recorder = await starting
    if (session !== current) {
      recorder.cancel()
      return
    }
    current.recorder = recorder
    current.startedAt = Date.now()
    setState({ phase: 'recording', ownerId, elapsedSec: 0 })
    startTicker()
  } catch (error) {
    if (session !== current) return
    session = undefined
    stopTicker()
    setState({ phase: 'idle', ownerId, elapsedSec: 0, error: messageOf(error) })
  }
}

function cancel(ownerId: string): void {
  const current = session
  if (current === undefined || current.ownerId !== ownerId) return
  session = undefined
  stopTicker()
  current.recorder?.cancel()
  void current.starting.then((recorder) => recorder.cancel()).catch(() => undefined)
  setState(IDLE)
}

function insertPending(ownerId: string, actions: ComposerInputActions): void {
  const pending = state.pending
  if (pending === undefined || pending.ownerId !== ownerId) return
  let span: unknown
  try {
    span = actions.captureInsertion()
  } catch {
    span = undefined
  }
  let inserted = false
  try {
    inserted = actions.insertText(pending.text, span)
  } catch {
    inserted = false
  }
  if (inserted) {
    setState(IDLE)
    focusComposer()
    return
  }
  setState({ ...state, error: '插入失败，请手动输入' })
}

function dismissPending(ownerId: string): void {
  if (state.pending?.ownerId === ownerId) setState(IDLE)
}

function disposeOwner(ownerId: string): void {
  if (session?.ownerId === ownerId) {
    cancel(ownerId)
    return
  }
  if (state.pending?.ownerId === ownerId) {
    setState(IDLE)
    return
  }
  if (state.ownerId === ownerId && state.phase === 'idle') {
    setState(IDLE)
  }
}

export const voiceController = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot(): VoiceState {
    return state
  },
  toggle,
  cancel,
  insertPending,
  dismissPending,
  disposeOwner,
}
