import assert from 'node:assert/strict'
import test from 'node:test'
import { CourseSessionTracker, feedbackRating } from '../lib/host/feedback.js'

test('feedbackRating 只识别消息反馈并映射为 up/down', () => {
  assert.equal(
    feedbackRating({ type: 'feedback/message-put', data: { item: { rating: 'positive' } } }),
    'up',
  )
  assert.equal(
    feedbackRating({ type: 'feedback/message-put', data: { item: { rating: 'negative' } } }),
    'down',
  )
  assert.equal(feedbackRating({ type: 'feedback/message-put', data: { item: {} } }), undefined)
  assert.equal(feedbackRating({ type: 'feedback/message-put', data: null }), undefined)
  assert.equal(
    feedbackRating({ type: 'feedback/message-put', data: { item: { rating: 'positive', note: 'x' } } }),
    'up',
  )
  assert.equal(
    feedbackRating({ type: 'feedback/message-delete', data: { messageId: 'm1' } }),
    undefined,
  )
  assert.equal(feedbackRating({ type: 'turn/start', data: { turn: 1 } }), undefined)
})

test('CourseSessionTracker 记录检索会话并在销毁时遗忘', () => {
  const tracker = new CourseSessionTracker()
  assert.equal(tracker.has('s1'), false)
  tracker.mark('s1')
  tracker.mark(undefined)
  assert.equal(tracker.has('s1'), true)
  assert.equal(tracker.has('undefined'), false)
  tracker.forget('s1')
  assert.equal(tracker.has('s1'), false)
})
