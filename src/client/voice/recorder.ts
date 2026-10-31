import {
  MAX_VOICE_DURATION_MS,
  VOICE_CHANNELS,
  VOICE_SAMPLE_RATE,
} from '../../shared/contracts.js'
import { bytesToBase64, encodeWav } from './audio.js'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

export class VoiceRecordingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceRecordingError'
  }
}

export interface RecordingResult {
  audioBase64: string
  durationMs: number
}

export interface Recorder {
  stop(): Promise<RecordingResult>
  cancel(): void
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

function mediaErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝，请在浏览器设置中允许后重试'
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return '未找到可用的麦克风'
    }
    if (error.name === 'NotReadableError') {
      return '麦克风被其它程序占用，请关闭后重试'
    }
  }
  return '无法启动录音，请检查麦克风权限'
}

async function transcode(blob: Blob): Promise<RecordingResult> {
  const bytes = await blob.arrayBuffer()
  const audioContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await audioContext.decodeAudioData(bytes)
  } catch {
    throw new VoiceRecordingError('录音数据无法处理，请重试')
  } finally {
    void audioContext.close().catch(() => undefined)
  }

  const maxFrames = (MAX_VOICE_DURATION_MS / 1000) * VOICE_SAMPLE_RATE
  const frames = Math.min(Math.ceil(decoded.duration * VOICE_SAMPLE_RATE), maxFrames)
  if (!Number.isFinite(frames) || frames < 1) {
    throw new VoiceRecordingError('没有录到声音，请重试')
  }

  const offline = new OfflineAudioContext(VOICE_CHANNELS, frames, VOICE_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  const wav = encodeWav(rendered.getChannelData(0), VOICE_SAMPLE_RATE)
  const durationMs = Math.max(
    1,
    Math.min(MAX_VOICE_DURATION_MS, Math.round((rendered.length / VOICE_SAMPLE_RATE) * 1000)),
  )
  return { audioBase64: bytesToBase64(wav), durationMs }
}

export async function beginRecording(): Promise<Recorder> {
  if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
    throw new VoiceRecordingError('当前环境不支持录音')
  }
  if (typeof MediaRecorder === 'undefined' || typeof AudioContext === 'undefined') {
    throw new VoiceRecordingError('当前环境不支持录音')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: VOICE_CHANNELS,
        sampleRate: VOICE_SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
  } catch (error) {
    throw new VoiceRecordingError(mediaErrorMessage(error))
  }

  const release = (): void => {
    for (const track of stream.getTracks()) track.stop()
  }

  const mimeType = pickMimeType()
  let media: MediaRecorder
  try {
    media = mimeType === undefined ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType })
  } catch {
    release()
    throw new VoiceRecordingError('当前环境不支持录音')
  }

  const chunks: Blob[] = []
  let failure: VoiceRecordingError | undefined
  let settle: () => void = () => undefined
  const stopped = new Promise<void>((resolve) => {
    settle = resolve
  })

  media.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  media.addEventListener('error', () => {
    failure = new VoiceRecordingError('录音失败，请重试')
    settle()
  })
  media.addEventListener('stop', settle, { once: true })
  media.start()

  let settled = false
  return {
    async stop(): Promise<RecordingResult> {
      if (settled) throw new VoiceRecordingError('录音已结束')
      settled = true
      try {
        if (media.state !== 'inactive') media.stop()
        await stopped
      } finally {
        release()
      }
      if (failure !== undefined) throw failure
      const blob = new Blob(chunks, { type: mimeType ?? 'audio/webm' })
      if (blob.size === 0) throw new VoiceRecordingError('没有录到声音，请重试')
      return await transcode(blob)
    },
    cancel(): void {
      if (settled) return
      settled = true
      try {
        if (media.state !== 'inactive') media.stop()
      } catch {
        // 停止失败也要释放麦克风。
      }
      release()
    },
  }
}
