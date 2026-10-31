import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bucketPosition,
  buildLearnerContextUpdate,
  clipSelectedText,
  formatPosition,
  sceneKey,
  selectionScopeKey,
} from '../lib/client/context-model.js'

test('bucketPosition 按 15 秒对齐并夹紧范围', () => {
  assert.equal(bucketPosition(-3), 0)
  assert.equal(bucketPosition(Number.NaN), 0)
  assert.equal(bucketPosition(0), 0)
  assert.equal(bucketPosition(14.9), 0)
  assert.equal(bucketPosition(15), 15)
  assert.equal(bucketPosition(29.9), 15)
  assert.equal(bucketPosition(37), 30)
  assert.equal(bucketPosition(86401), 86400)
})

test('formatPosition 输出 mm:ss 与 h:mm:ss', () => {
  assert.equal(formatPosition(0), '00:00')
  assert.equal(formatPosition(65), '01:05')
  assert.equal(formatPosition(125), '02:05')
  assert.equal(formatPosition(3725), '1:02:05')
})

test('clipSelectedText 归一化换行并按码点截断', () => {
  assert.equal(clipSelectedText('a\r\nb\rc'), 'a\nb\nc')
  assert.equal(clipSelectedText('x'.repeat(600), 500).length, 500)
  const emoji = clipSelectedText('😀'.repeat(600), 500)
  assert.equal(Array.from(emoji).length, 500)
  assert.equal(emoji.length, 1000)
})

test('buildLearnerContextUpdate 生成完整快照并省略空字段', () => {
  const update = buildLearnerContextUpdate({
    enabled: true,
    revision: 3,
    scene: {
      courseId: 'TC-101',
      courseTitle: '趋势交易',
      chapterId: 'ch-1',
      chapterTitle: '第一章',
      knowledgePointId: 'kp-1',
      knowledgePointTitle: '趋势反转',
      segmentId: 'seg-1',
      positionSec: 37,
    },
    selectedText: '放量突破',
  })
  assert.deepEqual(update, {
    revision: 3,
    enabled: true,
    courseId: 'TC-101',
    courseTitle: '趋势交易',
    chapterId: 'ch-1',
    chapterTitle: '第一章',
    knowledgePointId: 'kp-1',
    knowledgePointTitle: '趋势反转',
    positionSec: 30,
    selectedText: '放量突破',
  })

  assert.deepEqual(buildLearnerContextUpdate({ enabled: false, revision: 0 }), {
    revision: 0,
    enabled: false,
  })
  assert.deepEqual(buildLearnerContextUpdate({
    enabled: true,
    revision: 1,
    selectedText: '   ',
  }), { revision: 1, enabled: true })
})

test('sceneKey 区分片段，selectionScopeKey 只在课程层级变化时变化', () => {
  const base = {
    courseId: 'TC-101',
    chapterId: 'ch-1',
    knowledgePointId: 'kp-1',
    segmentId: 'seg-1',
  }
  assert.equal(sceneKey(base), sceneKey({ ...base }))
  assert.notEqual(sceneKey(base), sceneKey({ ...base, segmentId: 'seg-2' }))
  assert.equal(selectionScopeKey(base), selectionScopeKey({ ...base, segmentId: 'seg-2' }))
  assert.notEqual(selectionScopeKey(base), selectionScopeKey({ ...base, knowledgePointId: 'kp-2' }))
  assert.notEqual(selectionScopeKey(base), selectionScopeKey({ ...base, chapterId: 'ch-2' }))
  assert.equal(selectionScopeKey(undefined), '')
  assert.equal(sceneKey(undefined), '')
})
