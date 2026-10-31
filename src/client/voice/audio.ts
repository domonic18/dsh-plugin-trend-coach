import { VOICE_CHANNELS, VOICE_SAMPLE_RATE } from '../../shared/contracts.js'

const HEADER_BYTES = 44
const BASE64_CHUNK = 0x2000

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

/** 浏览器只能采集 webm/mp4，MiniMax 只收 wav；因此统一重采样后本地编码。 */
export function encodeWav(samples: Float32Array, sampleRate = VOICE_SAMPLE_RATE): Uint8Array {
  const blockAlign = VOICE_CHANNELS * 2
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes)
  const view = new DataView(bytes.buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, VOICE_CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = HEADER_BYTES
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
    offset += 2
  }
  return bytes
}

/** 分块拼接，避免 2MB 级数组一次性展开导致调用栈溢出。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}
