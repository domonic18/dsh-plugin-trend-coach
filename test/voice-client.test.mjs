import assert from 'node:assert/strict'
import test from 'node:test'
import { bytesToBase64, encodeWav } from '../lib/client/voice/audio.js'

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

test('encodeWav 写入标准 44 字节头', () => {
  const samples = new Float32Array(16000)
  const wav = encodeWav(samples, 16000)

  assert.equal(wav.byteLength, 44 + 16000 * 2)
  assert.equal(ascii(wav, 0, 4), 'RIFF')
  assert.equal(new DataView(wav.buffer).getUint32(4, true), 36 + 32000)
  assert.equal(ascii(wav, 8, 4), 'WAVE')
  assert.equal(ascii(wav, 12, 4), 'fmt ')
  assert.equal(new DataView(wav.buffer).getUint32(16, true), 16)
  assert.equal(new DataView(wav.buffer).getUint16(20, true), 1)
  assert.equal(new DataView(wav.buffer).getUint16(22, true), 1)
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 16000)
  assert.equal(new DataView(wav.buffer).getUint32(28, true), 32000)
  assert.equal(new DataView(wav.buffer).getUint16(32, true), 2)
  assert.equal(new DataView(wav.buffer).getUint16(34, true), 16)
  assert.equal(ascii(wav, 36, 4), 'data')
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 32000)
})

test('encodeWav 按 PCM16LE 量化并夹紧范围', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])
  const wav = encodeWav(samples, 16000)
  const view = new DataView(wav.buffer)
  const values = []
  for (let index = 0; index < samples.length; index += 1) {
    values.push(view.getInt16(44 + index * 2, true))
  }
  assert.deepEqual(values, [0, 16384, -16384, 32767, -32768, 32767, -32768])
})

test('encodeWav 支持自定义采样率', () => {
  const wav = encodeWav(new Float32Array(8000), 8000)
  const view = new DataView(wav.buffer)
  assert.equal(view.getUint32(24, true), 8000)
  assert.equal(view.getUint32(28, true), 16000)
})

test('bytesToBase64 与 Buffer 结果一致', () => {
  const bytes = new Uint8Array([0, 1, 2, 255, 128, 64])
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'))
  assert.equal(bytesToBase64(new Uint8Array(0)), '')
})

test('bytesToBase64 处理大数组不溢出调用栈', () => {
  const bytes = new Uint8Array(1_920_044)
  const encoded = bytesToBase64(bytes)
  assert.equal(encoded.length, 2_560_060)
  assert.equal(encoded, Buffer.from(bytes).toString('base64'))
})
