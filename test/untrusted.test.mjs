import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SEGMENT_DATA_CLOSE,
  SEGMENT_DATA_OPEN,
  sanitizeUntrusted,
  wrapUntrusted,
} from '../lib/untrusted.js'

const CLOSE_TOKEN = '</' + 'course_segment_data>'
const OPEN_TOKEN = '<' + 'course_segment_data>'

test('sanitizeUntrusted 剥离控制字符但保留制表与换行', () => {
  const control = [0, 7, 27, 31, 127].map((code) => String.fromCharCode(code)).join('')
  assert.equal(sanitizeUntrusted('a' + control + 'b'), 'ab')
  assert.equal(sanitizeUntrusted('a\tb\nc\rd'), 'a\tb\nc\rd')
  assert.equal(sanitizeUntrusted('趋势反转'), '趋势反转')
})

test('sanitizeUntrusted 转义正文伪造的边界 token', () => {
  const out = sanitizeUntrusted(CLOSE_TOKEN + 'fallback' + OPEN_TOKEN)
  assert.equal(out, '＜/course_segment_data>fallback＜course_segment_data>')
  assert.equal(/<\/?course_segment_data/.test(out), false)
  assert.equal(sanitizeUntrusted('<COURSE_SEGMENT_DATA>'), '＜COURSE_SEGMENT_DATA>')
})

test('wrapUntrusted 生成唯一一组固定边界', () => {
  const wrapped = wrapUntrusted('x' + CLOSE_TOKEN)
  assert.equal(wrapped, `${SEGMENT_DATA_OPEN}\nx＜/course_segment_data>\n${SEGMENT_DATA_CLOSE}`)
  assert.equal((wrapped.match(new RegExp(CLOSE_TOKEN, 'g')) ?? []).length, 1)
  assert.equal(wrapped.startsWith(`${SEGMENT_DATA_OPEN}\n`), true)
  assert.equal(wrapped.endsWith(`\n${SEGMENT_DATA_CLOSE}`), true)
})
