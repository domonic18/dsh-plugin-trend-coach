/** 供 Host/Remote/mock 契约测试复用的最小 WAV 生成器。 */
export function makeWav({
  sampleRate = 16000,
  channels = 1,
  bits = 16,
  durationMs = 1000,
  audioFormat = 1,
} = {}) {
  const blockAlign = (channels * bits) / 8
  const dataBytes = Math.round((sampleRate * blockAlign * durationMs) / 1000)
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(audioFormat, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bits, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

export function wavBase64(options = {}) {
  return makeWav(options).toString('base64')
}
