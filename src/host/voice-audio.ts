import {
  MAX_VOICE_BASE64_CHARS,
  MAX_VOICE_DURATION_MS,
  MAX_VOICE_WAV_BYTES,
  VOICE_BITS_PER_SAMPLE,
  VOICE_CHANNELS,
  VOICE_SAMPLE_RATE,
} from '../shared/contracts.js'
import { InputError } from '../errors.js'

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
// 允许音频实际时长与客户端上报值有 1s 误差，避免编码器补齐导致边界误判。
const DURATION_TOLERANCE_MS = 1000

export interface VoiceAudio {
  bytes: Uint8Array
  durationMs: number
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

/** Host 边界先于云端校验音频；不信任浏览器上报的格式与时长。 */
export function decodeVoiceWav(audioBase64: unknown, durationMs: unknown): VoiceAudio {
  if (typeof audioBase64 !== 'string') throw new InputError('录音数据必须是字符串')
  if (audioBase64.length === 0) throw new InputError('录音数据不能为空')
  if (audioBase64.length > MAX_VOICE_BASE64_CHARS) throw new InputError('录音数据过长')
  if (audioBase64.length % 4 !== 0 || !BASE64_PATTERN.test(audioBase64)) {
    throw new InputError('录音数据编码不合法')
  }

  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs)
    || durationMs < 1 || durationMs > MAX_VOICE_DURATION_MS) {
    throw new InputError(`录音时长必须是 1–${MAX_VOICE_DURATION_MS} 的整数毫秒`)
  }

  const bytes = new Uint8Array(Buffer.from(audioBase64, 'base64'))
  if (bytes.byteLength < 44) throw new InputError('录音数据格式不合法')
  if (bytes.byteLength > MAX_VOICE_WAV_BYTES) throw new InputError('录音数据过长')
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new InputError('录音数据不是合法的 WAV 文件')
  }

  let fmtOffset = -1
  let dataOffset = -1
  let dataLength = -1
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = ascii(bytes, offset, 4)
    const chunkSize = readUint32LE(bytes, offset + 4)
    const chunkStart = offset + 8
    if (chunkStart + chunkSize > bytes.byteLength) throw new InputError('录音数据格式不合法')
    if (chunkId === 'fmt ') fmtOffset = chunkStart
    if (chunkId === 'data') {
      dataOffset = chunkStart
      dataLength = chunkSize
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  if (fmtOffset < 0 || dataOffset < 0) throw new InputError('录音数据缺少必要的 WAV 块')
  if (readUint16LE(bytes, fmtOffset) !== 1) throw new InputError('录音数据必须为 PCM 编码')
  if (readUint16LE(bytes, fmtOffset + 2) !== VOICE_CHANNELS) throw new InputError('录音数据必须为单声道')
  if (readUint32LE(bytes, fmtOffset + 4) !== VOICE_SAMPLE_RATE) {
    throw new InputError(`录音采样率必须为 ${VOICE_SAMPLE_RATE}Hz`)
  }
  if (readUint16LE(bytes, fmtOffset + 14) !== VOICE_BITS_PER_SAMPLE) {
    throw new InputError('录音位深必须为 16bit')
  }

  const actualDurationMs = (dataLength / (VOICE_SAMPLE_RATE * VOICE_CHANNELS * (VOICE_BITS_PER_SAMPLE / 8))) * 1000
  if (actualDurationMs > MAX_VOICE_DURATION_MS + DURATION_TOLERANCE_MS) {
    throw new InputError('录音时长超过上限')
  }
  if (Math.abs(actualDurationMs - durationMs) > DURATION_TOLERANCE_MS) {
    throw new InputError('录音时长与数据不一致')
  }

  return { bytes, durationMs }
}
