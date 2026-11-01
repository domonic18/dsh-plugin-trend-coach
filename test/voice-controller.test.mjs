import assert from 'node:assert/strict'
import test from 'node:test'

function fakeStream(tracks) {
  return { getTracks: () => tracks }
}

function fakeTrack() {
  return { stopped: false, stop() { this.stopped = true } }
}

let nextStream = () => fakeStream([fakeTrack()])

class FakeMediaRecorder {
  static isTypeSupported() { return true }
  constructor(stream) {
    this.stream = stream
    this.state = 'inactive'
  }
  addEventListener() {}
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive' }
}

class FakeAudioContext {
  close() { return Promise.resolve() }
}

const navigatorStub = {
  mediaDevices: {
    getUserMedia: async () => nextStream(),
  },
}

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorStub })
globalThis.MediaRecorder = FakeMediaRecorder
globalThis.AudioContext = FakeAudioContext

const { voiceController } = await import('../lib/client/voice/controller.js')

function actions() {
  return {
    captureInsertion: () => 'span',
    insertText: () => { throw new Error('取消后不应插入文本') },
  }
}

function remote(counts) {
  return {
    async transcribeVoice() {
      counts.calls += 1
      throw new Error('取消后不应发起转写')
    },
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('录音中取消：释放麦克风、回到空闲且不发起转写', async () => {
  const track = fakeTrack()
  nextStream = () => fakeStream([track])
  const counts = { calls: 0 }

  await voiceController.toggle('owner-record', actions(), remote(counts))
  assert.equal(voiceController.getSnapshot().phase, 'recording')

  voiceController.cancel('owner-record')
  assert.equal(voiceController.getSnapshot().phase, 'idle')
  assert.equal(track.stopped, true)
  await tick()
  assert.equal(counts.calls, 0)
})

test('授权等待中取消：随后到达的流也会被释放，且不发起转写', async () => {
  let resolveGetUserMedia
  const track = fakeTrack()
  navigatorStub.mediaDevices.getUserMedia = () => new Promise((resolve) => {
    resolveGetUserMedia = () => resolve(fakeStream([track]))
  })
  const counts = { calls: 0 }

  const pending = voiceController.toggle('owner-starting', actions(), remote(counts))
  assert.equal(voiceController.getSnapshot().phase, 'starting')

  voiceController.cancel('owner-starting')
  assert.equal(voiceController.getSnapshot().phase, 'idle')

  resolveGetUserMedia()
  await pending
  await tick()
  assert.equal(track.stopped, true)
  assert.equal(counts.calls, 0)
})
