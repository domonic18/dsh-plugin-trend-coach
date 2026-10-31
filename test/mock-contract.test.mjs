import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import test from 'node:test'

const DEVICE_ID = 'contract-device-001'
const OTHER_DEVICE_ID = 'contract-device-002'

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForHealth(base, child) {
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) break
    try {
      const response = await fetch(`${base}/health`)
      if (response.ok) return
    } catch {
      // 服务尚未就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`mock 服务未启动: ${stderr}`)
}

test('mock 云端接口满足对接清单', async (t) => {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, ['spike/mock-kb-server.mjs'], {
    env: { ...process.env, MOCK_KB_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  t.after(() => {
    child.kill()
  })

  await waitForHealth(base, child)

  let grant
  const api = async (path, { method = 'GET', body, token, deviceId = DEVICE_ID, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}`, 'x-device-id': deviceId }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { response, status: response.status, json, text, headers: response.headers }
  }

  await t.test('设备码授权闭环', async () => {
    const start = await api('/v1/auth/device/code', {
      method: 'POST',
      body: { clientId: 'dsh-plugin-trend-coach', deviceId: DEVICE_ID },
    })
    assert.equal(start.status, 200)
    assert.equal(typeof start.json.deviceCode, 'string')
    assert.equal(typeof start.json.userCode, 'string')
    assert.equal(start.json.verificationUri, `${base}/device?code=${encodeURIComponent(start.json.userCode)}`)
    assert.equal(Number.isInteger(start.json.expiresIn), true)
    assert.equal(Number.isInteger(start.json.interval), true)

    const pending = await api('/v1/auth/device/token', {
      method: 'POST',
      body: { deviceCode: start.json.deviceCode },
    })
    assert.deepEqual(pending.json, { status: 'pending' })

    const approve = await api('/v1/auth/device/approve', {
      method: 'POST',
      body: { userCode: start.json.userCode },
    })
    assert.equal(approve.status, 200)

    const authorized = await api('/v1/auth/device/token', {
      method: 'POST',
      body: { deviceCode: start.json.deviceCode },
    })
    assert.equal(authorized.json.status, 'authorized')
    grant = authorized.json.grant
    assert.equal(grant.deviceId, DEVICE_ID)
    assert.equal(typeof grant.accessToken, 'string')
    assert.equal(typeof grant.refreshToken, 'string')
    assert.equal(grant.expiresAt > Date.now(), true)
  })

  await t.test('业务接口要求 Bearer 与设备绑定', async () => {
    const missing = await api('/v1/kb/search', { method: 'POST', body: { query: '趋势' } })
    assert.equal(missing.status, 401)

    const mismatch = await api('/v1/kb/search', {
      method: 'POST',
      body: { query: '趋势' },
      token: grant.accessToken,
      deviceId: OTHER_DEVICE_ID,
    })
    assert.equal(mismatch.status, 403)
  })

  await t.test('检索返回合法片段与展示字段', async () => {
    const { status, json, text } = await api('/v1/kb/search', {
      method: 'POST',
      body: { query: '趋势结构', topK: 5 },
      token: grant.accessToken,
    })
    assert.equal(status, 200)
    assert.equal(Buffer.byteLength(text) <= 512 * 1024, true)
    assert.equal(Array.isArray(json.segments), true)
    assert.equal(json.segments.length > 0, true)
    assert.equal(Array.isArray(json.relatedKnowledgePoints), true)

    for (const segment of json.segments) {
      assert.match(segment.segmentId, /^seg-[A-Za-z0-9._-]+$/)
      assert.equal(segment.segmentId.length <= 80, true)
      assert.equal(typeof segment.courseId, 'string')
      assert.equal(typeof segment.chapterId, 'string')
      assert.equal(typeof segment.knowledgePointId, 'string')
      assert.equal(typeof segment.title, 'string')
      assert.equal(segment.title.length <= 200, true)
      assert.equal(segment.startSec >= 0, true)
      assert.equal(segment.endSec > segment.startSec, true)
      assert.equal(segment.text.length <= 4000, true)
      assert.equal(segment.score >= 0 && segment.score <= 1, true)
    }

    const hit = json.segments.find((segment) => segment.segmentId === 'seg-tc101-m1-kp1-2')
    assert.ok(hit)
    assert.equal(hit.courseTitle, '趋势交易基础')
    assert.equal(hit.chapterTitle, '第一章 趋势认知')
    assert.equal(hit.knowledgePointTitle, '趋势结构:推动段与调整段')
  })

  await t.test('空召回只返回相关知识点标题', async () => {
    const { status, json } = await api('/v1/kb/search', {
      method: 'POST',
      body: { query: '外汇保证金怎么计算' },
      token: grant.accessToken,
    })
    assert.equal(status, 200)
    assert.deepEqual(json.segments, [])
    assert.equal(json.relatedKnowledgePoints.length > 0, true)
    assert.equal(json.relatedKnowledgePoints.length <= 5, true)
    for (const point of json.relatedKnowledgePoints) {
      assert.deepEqual(Object.keys(point).sort(), ['knowledgePointId', 'title'])
    }
  })

  await t.test('非法入参返回 400', async () => {
    const cases = [
      { query: 'a'.repeat(501) },
      { query: '趋势', topK: 0 },
      { query: '趋势', topK: 21 },
      { query: '趋势', topK: 5.5 },
      { query: '趋势', courseId: 'bad/course' },
      { query: '   ' },
    ]
    for (const body of cases) {
      const { status } = await api('/v1/kb/search', {
        method: 'POST',
        body,
        token: grant.accessToken,
      })
      assert.equal(status, 400, JSON.stringify(body))
    }
  })

  await t.test('片段详情返回权威起止秒', async () => {
    const found = await api('/v1/kb/segments/seg-tc101-m3-kp3-2', { token: grant.accessToken })
    assert.equal(found.status, 200)
    assert.equal(found.json.segmentId, 'seg-tc101-m3-kp3-2')
    assert.equal(found.json.startSec, 2300)
    assert.equal(found.json.endSec, 2535)
    assert.equal(found.json.courseTitle, '趋势交易基础')

    const missing = await api('/v1/kb/segments/seg-not-exist', { token: grant.accessToken })
    assert.equal(missing.status, 404)
  })

  await t.test('播放会话、签名 HLS 与 Range', async () => {
    const created = await api('/v1/playback/sessions', {
      method: 'POST',
      body: { segmentId: 'seg-tc101-m1-kp1-2' },
      token: grant.accessToken,
    })
    assert.equal(created.status, 200)
    const session = created.json
    assert.equal(typeof session.sessionId, 'string')
    assert.equal(new URL(session.playlistUrl).protocol, 'http:')
    assert.equal(session.expiresAt > Date.now() + 60_000, true)
    assert.equal(typeof session.watermark.label, 'string')

    const playlist = await fetch(session.playlistUrl)
    assert.equal(playlist.status, 200)
    assert.equal(playlist.headers.get('access-control-allow-origin'), '*')
    const body = await playlist.text()
    assert.match(body, /^#EXTM3U/)
    assert.match(body, /#EXT-X-KEY:METHOD=AES-128,URI="enc\.key\?token=/)
    assert.match(body, /seg\d+\.ts\?token=/)

    const media = await fetch(`${base}/media/lesson.mp4`, { headers: { range: 'bytes=0-99' } })
    assert.equal(media.status, 206)
    assert.equal(media.headers.get('accept-ranges'), 'bytes')
    assert.match(media.headers.get('content-range'), /^bytes 0-99\/\d+$/)
    assert.equal((await media.arrayBuffer()).byteLength, 100)

    const missing = await api('/v1/playback/sessions', {
      method: 'POST',
      body: { segmentId: 'seg-not-exist' },
      token: grant.accessToken,
    })
    assert.equal(missing.status, 404)
  })

  await t.test('事件同意与白名单上报', async () => {
    const initial = await api('/v1/events/consent', { token: grant.accessToken })
    assert.equal(initial.status, 200)
    assert.deepEqual(initial.json, { consent: false })

    const event = {
      eventId: 'evt-mock-contract-0001',
      name: 'search_requested',
      props: { durationMs: 42, topK: 5, hits: 2, empty: false },
    }

    const denied = await api('/v1/events', {
      method: 'POST',
      body: event,
      token: grant.accessToken,
    })
    assert.equal(denied.status, 403)

    const invalidConsent = await api('/v1/events/consent', {
      method: 'PUT',
      body: { consent: 'yes' },
      token: grant.accessToken,
    })
    assert.equal(invalidConsent.status, 400)

    const granted = await api('/v1/events/consent', {
      method: 'PUT',
      body: { consent: true },
      token: grant.accessToken,
    })
    assert.equal(granted.status, 200)
    assert.deepEqual(granted.json, { consent: true })

    const accepted = await api('/v1/events', {
      method: 'POST',
      body: event,
      token: grant.accessToken,
    })
    assert.equal(accepted.status, 202)
    assert.deepEqual(accepted.json, { accepted: true })

    const duplicate = await api('/v1/events', {
      method: 'POST',
      body: event,
      token: grant.accessToken,
    })
    assert.equal(duplicate.status, 202)

    const invalidEvents = [
      { ...event, eventId: 'evt-mock-contract-0002', name: 'answer_generated', props: {} },
      { ...event, eventId: 'evt-mock-contract-0003', props: { ...event.props, query: '趋势' } },
      { eventId: 'evt-mock-contract-0004', name: 'citation_clicked', props: { segmentId: 'bad' } },
    ]
    for (const payload of invalidEvents) {
      const invalid = await api('/v1/events', {
        method: 'POST',
        body: payload,
        token: grant.accessToken,
      })
      assert.equal(invalid.status, 400, JSON.stringify(payload))
    }

    const revoked = await api('/v1/events/consent', {
      method: 'PUT',
      body: { consent: false },
      token: grant.accessToken,
    })
    assert.deepEqual(revoked.json, { consent: false })

    const deniedAfterRevoke = await api('/v1/events', {
      method: 'POST',
      body: { ...event, eventId: 'evt-mock-contract-0005' },
      token: grant.accessToken,
    })
    assert.equal(deniedAfterRevoke.status, 403)
  })

  await t.test('刷新轮换并使旧 refresh 失效', async () => {
    const refreshed = await api('/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: grant.refreshToken, deviceId: DEVICE_ID },
    })
    assert.equal(refreshed.status, 200)
    assert.notEqual(refreshed.json.refreshToken, grant.refreshToken)

    const reused = await api('/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: grant.refreshToken, deviceId: DEVICE_ID },
    })
    assert.equal(reused.status, 401)

    const mismatch = await api('/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refreshed.json.refreshToken, deviceId: OTHER_DEVICE_ID },
    })
    assert.equal(mismatch.status, 403)

    grant = refreshed.json
  })

  await t.test('注销吊销本设备令牌', async () => {
    const deviceId = 'contract-device-003'
    const start = await api('/v1/auth/device/code', {
      method: 'POST',
      body: { clientId: 'dsh-plugin-trend-coach', deviceId },
    })
    await api('/v1/auth/device/approve', {
      method: 'POST',
      body: { userCode: start.json.userCode },
    })
    const authorized = await api('/v1/auth/device/token', {
      method: 'POST',
      body: { deviceCode: start.json.deviceCode },
    })
    const own = authorized.json.grant

    const revoked = await api('/v1/auth/revoke', {
      method: 'POST',
      body: {},
      token: own.accessToken,
      deviceId,
    })
    assert.equal(revoked.status, 200)
    assert.deepEqual(revoked.json, { revoked: true })

    const denied = await api('/v1/kb/search', {
      method: 'POST',
      body: { query: '趋势' },
      token: own.accessToken,
      deviceId,
    })
    assert.equal(denied.status, 401)

    const refreshDenied = await api('/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: own.refreshToken, deviceId },
    })
    assert.equal(refreshDenied.status, 401)
  })

  await t.test('access 过期后返回 401', async () => {
    const expired = await api('/v1/debug/expire', { method: 'POST', body: {} })
    assert.equal(expired.status, 200)

    const { status } = await api('/v1/kb/search', {
      method: 'POST',
      body: { query: '趋势' },
      token: grant.accessToken,
    })
    assert.equal(status, 401)
  })
})
