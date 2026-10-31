import assert from 'node:assert/strict'
import test from 'node:test'
import { InputError } from '../lib/errors.js'
import { decodeVoiceWav } from '../lib/host/voice-audio.js'
import { MAX_VOICE_BASE64_CHARS } from '../lib/shared/contracts.js'
import { makeWav, wavBase64 } from './voice-fixtures.mjs'

test('decodeVoiceWav 接受 16k 单声道 16bit WAV', () => {
  const audio = decodeVoiceWav(wavBase64({ durationMs: 12000 }), 12000)
  assert.equal(audio.durationMs, 12000)
  assert.equal(audio.bytes.byteLength, 44 + 16000 * 2 * 12)
})

test('decodeVoiceWav 允许数据与上报时长有 1s 误差', () => {
  assert.doesNotThrow(() => decodeVoiceWav(wavBase64({ durationMs: 1000 }), 1900))
  assert.doesNotThrow(() => decodeVoiceWav(wavBase64({ durationMs: 2000 }), 1001))
})

test('decodeVoiceWav 拒绝非法 base64 与超长输入', () => {
  assert.throws(() => decodeVoiceWav('not base64!!', 1000), InputError)
  assert.throws(() => decodeVoiceWav('AAA', 1000), InputError)
  assert.throws(() => decodeVoiceWav('', 1000), InputError)
  assert.throws(() => decodeVoiceWav(123, 1000), InputError)
  assert.throws(() => decodeVoiceWav('A'.repeat(MAX_VOICE_BASE64_CHARS + 4), 1000), InputError)
})

test('decodeVoiceWav 拒绝非法时长', () => {
  const audio = wavBase64({ durationMs: 1000 })
  for (const duration of [0, -1, 60_001, 1.5, Number.NaN, '1000', undefined]) {
    assert.throws(() => decodeVoiceWav(audio, duration), InputError)
  }
})

test('decodeVoiceWav 校验 WAV 结构', () => {
  const wrongMagic = makeWav({ durationMs: 1000 })
  wrongMagic.write('RIFX', 0, 'ascii')
  assert.throws(() => decodeVoiceWav(wrongMagic.toString('base64'), 1000), InputError)

  const wrongWave = makeWav({ durationMs: 1000 })
  wrongWave.write('AVI ', 8, 'ascii')
  assert.throws(() => decodeVoiceWav(wrongWave.toString('base64'), 1000), InputError)

  assert.throws(() => decodeVoiceWav(Buffer.alloc(20).toString('base64'), 1), InputError)
})

test('decodeVoiceWav 只接受 PCM 单声道 16k 16bit', () => {
  for (const options of [
    { audioFormat: 3 },
    { channels: 2 },
    { sampleRate: 44_100 },
    { bits: 8 },
  ]) {
    assert.throws(
      () => decodeVoiceWav(wavBase64({ durationMs: 1000, ...options }), 1000),
      InputError,
      JSON.stringify(options),
    )
  }
})

test('decodeVoiceWav 拒绝时长不一致与超过 60s', () => {
  assert.throws(() => decodeVoiceWav(wavBase64({ durationMs: 10_000 }), 1000), InputError)
  assert.throws(() => decodeVoiceWav(wavBase64({ durationMs: 61_000 }), 60_000), InputError)
})

test('decodeVoiceWav 拒绝 data 块越界', () => {
  const truncated = makeWav({ durationMs: 1000 }).subarray(0, 2000)
  assert.throws(() => decodeVoiceWav(truncated.toString('base64'), 1000), InputError)
})
