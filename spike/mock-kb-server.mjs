import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'),
)

const port = Number(process.env.MOCK_KB_PORT ?? 3939)
const origin = `http://127.0.0.1:${port}`
const hlsDir = fileURLToPath(new URL('./media/hls/', import.meta.url))
const playlistFile = `${hlsDir}index.m3u8`
const keyFile = `${hlsDir}enc.key`
const sessionTtlMs = 10 * 60 * 1000
const sessions = new Map()

const accessTtlMs = Number(process.env.MOCK_ACCESS_TTL_MS ?? 120_000)
const deviceTtlMs = 5 * 60 * 1000
const devicePollIntervalSec = 2
const deviceCodes = new Map()
const userCodes = new Map()
const accessTokens = new Map()
const refreshTokens = new Map()

function scoreSegment(segment, query) {
  const hits = segment.keywords.filter(keyword => query.includes(keyword)).length
  if (hits === 0) return 0
  return Math.min(0.99, Number((0.5 + hits * 0.1).toFixed(3)))
}

function search({ query, courseId, topK }) {
  return fixtures
    .filter(segment => courseId === undefined || segment.courseId === courseId)
    .map(segment => ({ segment, score: scoreSegment(segment, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ segment, score }) => ({
      segmentId: segment.segmentId,
      courseId: segment.courseId,
      chapterId: segment.chapterId,
      knowledgePointId: segment.knowledgePointId,
      title: segment.title,
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: segment.text,
      score,
    }))
}

function cors(response) {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type, authorization, x-device-id')
}

function json(response, status, payload) {
  cors(response)
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function issueSession(deviceId) {
  const token = randomBytes(24).toString('hex')
  const sessionId = `ps_${randomBytes(8).toString('hex')}`
  const expiresAt = Date.now() + sessionTtlMs
  sessions.set(token, expiresAt)
  return {
    sessionId,
    expiresAt,
    playlistUrl: `${origin}/media/hls/index.m3u8?token=${token}`,
    watermark: { label: `学员 ${deviceId.slice(0, 6)}` },
  }
}

function issueGrant(deviceId) {
  const accessToken = randomBytes(24).toString('hex')
  const refreshToken = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + accessTtlMs
  accessTokens.set(accessToken, { deviceId, expiresAt })
  refreshTokens.set(refreshToken, { deviceId })
  return { accessToken, refreshToken, expiresAt, deviceId }
}

function authenticate(request) {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return { status: 401 }
  const token = header.slice('Bearer '.length)
  const entry = accessTokens.get(token)
  if (entry === undefined) return { status: 401 }
  if (entry.expiresAt <= Date.now()) {
    accessTokens.delete(token)
    return { status: 401 }
  }
  const deviceId = request.headers['x-device-id']
  if (typeof deviceId !== 'string' || deviceId !== entry.deviceId) return { status: 403 }
  return { ok: true, deviceId: entry.deviceId }
}

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeUserCode() {
  const pick = () => USER_CODE_ALPHABET[randomBytes(1)[0] % USER_CODE_ALPHABET.length]
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`
}

function requireAuth(request, response) {
  const auth = authenticate(request)
  if (auth.ok === true) return auth
  json(response, auth.status, { error: auth.status === 403 ? 'device mismatch' : 'unauthorized' })
  return undefined
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

function serveDevicePage(response, url) {
  const userCode = url.searchParams.get('code') ?? ''
  const body = `<!doctype html>
<meta charset="utf-8">
<title>趋势伴学设备授权</title>
<h1>趋势伴学设备授权</h1>
<p>设备码：<code>${escapeHtml(userCode)}</code></p>
<p id="msg">确认是本人操作后点击批准。</p>
<button id="approve">批准授权</button>
<script>
document.getElementById('approve').addEventListener('click', async () => {
  const response = await fetch('/v1/auth/device/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userCode: ${JSON.stringify(userCode)} }),
  })
  document.getElementById('msg').textContent = response.ok ? '已授权，请回到客户端等待生效。' : '设备码无效或已过期。'
})
</script>`
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(body)
}

function tokenFrom(url) {
  const token = url.searchParams.get('token')
  if (token === null) return undefined
  const expiresAt = sessions.get(token)
  if (expiresAt === undefined) return undefined
  if (expiresAt <= Date.now()) {
    sessions.delete(token)
    return undefined
  }
  return token
}

function serveHls(request, response, url) {
  const token = tokenFrom(url)
  if (token === undefined) {
    json(response, 403, { error: 'playback token invalid or expired' })
    return
  }

  const name = decodeURIComponent(url.pathname.slice('/media/hls/'.length))
  if (!/^(index\.m3u8|enc\.key|seg\d{4,}\.ts)$/.test(name)) {
    json(response, 404, { error: 'not found' })
    return
  }

  if (name === 'index.m3u8') {
    const body = readFileSync(playlistFile, 'utf8')
      .replaceAll('URI="enc.key"', `URI="enc.key?token=${token}"`)
      .replaceAll(/^(seg\d+\.ts)$/gm, `$1?token=${token}`)
    cors(response)
    response.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
    })
    response.end(body)
    return
  }

  const file = `${hlsDir}${name}`
  const size = statSync(file).size
  cors(response)
  response.writeHead(200, {
    'content-type': name === 'enc.key' ? 'application/octet-stream' : 'video/mp2t',
    'content-length': size,
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(response)
}

const mediaFile = fileURLToPath(new URL('./media/lesson.mp4', import.meta.url))

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    cors(response)
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url, origin)

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/device') {
    serveDevicePage(response, url)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/code') {
    const payload = await readJson(request)
    if (typeof payload?.clientId !== 'string' || typeof payload?.deviceId !== 'string') {
      json(response, 400, { error: 'clientId and deviceId are required' })
      return
    }
    const deviceCode = randomBytes(18).toString('hex')
    let userCode = makeUserCode()
    while (userCodes.has(userCode)) userCode = makeUserCode()
    deviceCodes.set(deviceCode, {
      userCode,
      deviceId: payload.deviceId,
      expiresAt: Date.now() + deviceTtlMs,
      approved: false,
    })
    userCodes.set(userCode, deviceCode)
    console.log(`[mock-kb] device code issued userCode=${userCode} device=${payload.deviceId}`)
    json(response, 200, {
      deviceCode,
      userCode,
      verificationUri: `${origin}/device?code=${encodeURIComponent(userCode)}`,
      expiresIn: Math.floor(deviceTtlMs / 1000),
      interval: devicePollIntervalSec,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/approve') {
    const payload = await readJson(request)
    const userCode = typeof payload?.userCode === 'string' ? payload.userCode.trim().toUpperCase() : ''
    const deviceCode = userCodes.get(userCode)
    const entry = deviceCode === undefined ? undefined : deviceCodes.get(deviceCode)
    if (entry === undefined || Date.now() >= entry.expiresAt) {
      json(response, 404, { error: 'device code invalid or expired' })
      return
    }
    entry.approved = true
    console.log(`[mock-kb] device code approved userCode=${userCode}`)
    json(response, 200, { approved: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/device/token') {
    const payload = await readJson(request)
    const deviceCode = payload?.deviceCode
    const entry = typeof deviceCode === 'string' ? deviceCodes.get(deviceCode) : undefined
    if (entry === undefined) {
      json(response, 200, { status: 'expired' })
      return
    }
    if (Date.now() >= entry.expiresAt) {
      deviceCodes.delete(deviceCode)
      userCodes.delete(entry.userCode)
      json(response, 200, { status: 'expired' })
      return
    }
    if (!entry.approved) {
      json(response, 200, { status: 'pending' })
      return
    }
    deviceCodes.delete(deviceCode)
    userCodes.delete(entry.userCode)
    const grant = issueGrant(entry.deviceId)
    console.log(`[mock-kb] device authorized userCode=${entry.userCode} device=${entry.deviceId}`)
    json(response, 200, { status: 'authorized', grant })
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/refresh') {
    const payload = await readJson(request)
    const refreshToken = payload?.refreshToken
    const deviceId = payload?.deviceId
    const entry = typeof refreshToken === 'string' ? refreshTokens.get(refreshToken) : undefined
    if (entry === undefined) {
      json(response, 401, { error: 'refresh token invalid' })
      return
    }
    if (deviceId !== entry.deviceId) {
      json(response, 403, { error: 'device mismatch' })
      return
    }
    refreshTokens.delete(refreshToken)
    for (const [token, meta] of accessTokens) {
      if (meta.deviceId === entry.deviceId) accessTokens.delete(token)
    }
    const grant = issueGrant(entry.deviceId)
    console.log(`[mock-kb] token refreshed device=${entry.deviceId}`)
    json(response, 200, grant)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/debug/expire') {
    let expired = 0
    for (const meta of accessTokens.values()) {
      if (meta.expiresAt > Date.now()) expired += 1
      meta.expiresAt = 0
    }
    json(response, 200, { expired })
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/media/hls/')) {
    serveHls(request, response, url)
    return
  }

  if (request.method === 'GET' && url.pathname === '/media/lesson.mp4') {
    const total = statSync(mediaFile).size
    const range = request.headers.range
    cors(response)
    response.setHeader('accept-ranges', 'bytes')
    response.setHeader('content-type', 'video/mp4')
    if (range === undefined) {
      response.writeHead(200, { 'content-length': total })
      createReadStream(mediaFile).pipe(response)
      return
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    const start = match?.[1] === '' || match?.[1] === undefined ? 0 : Number(match[1])
    const end = match?.[2] === '' || match?.[2] === undefined ? total - 1 : Math.min(Number(match[2]), total - 1)
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      response.writeHead(416, { 'content-range': `bytes */${total}` })
      response.end()
      return
    }
    response.writeHead(206, {
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${total}`,
    })
    createReadStream(mediaFile, { start, end }).pipe(response)
    return
  }

  if (request.method === 'POST' && url.pathname === '/v1/playback/sessions') {
    const auth = requireAuth(request, response)
    if (auth === undefined) return
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let payload
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      json(response, 400, { error: 'invalid json' })
      return
    }
    const segmentId = payload?.segmentId
    if (typeof segmentId !== 'string' || !fixtures.some(item => item.segmentId === segmentId)) {
      json(response, 404, { error: 'segment not found' })
      return
    }
    if (!statSync(playlistFile, { throwIfNoEntry: false })) {
      json(response, 503, { error: 'hls asset missing, run npm run mock:rebuild' })
      return
    }
    const session = issueSession(auth.deviceId)
    console.log(`[mock-kb] playback session ${session.sessionId} segment=${segmentId}`)
    json(response, 200, session)
    return
  }

  if (request.method === 'GET' && url.pathname.startsWith('/v1/kb/segments/')) {
    if (requireAuth(request, response) === undefined) return
    const segmentId = decodeURIComponent(url.pathname.slice('/v1/kb/segments/'.length))
    const segment = fixtures.find(item => item.segmentId === segmentId)
    if (segment === undefined) {
      json(response, 404, { error: 'segment not found' })
      return
    }
    const { keywords: _keywords, ...publicSegment } = segment
    json(response, 200, { ...publicSegment, score: 1 })
    return
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/kb/search') {
    json(response, 404, { error: 'not found' })
    return
  }

  if (requireAuth(request, response) === undefined) return

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)

  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    json(response, 400, { error: 'invalid json' })
    return
  }

  const query = payload?.query
  if (typeof query !== 'string' || query.trim() === '') {
    json(response, 400, { error: 'query is required' })
    return
  }

  const topK = Number.isInteger(payload.topK) ? Math.min(Math.max(payload.topK, 1), 20) : 5
  const segments = search({ query, courseId: payload.courseId, topK })

  console.log(`[mock-kb] query=${JSON.stringify(query)} hits=${segments.length}`)
  json(response, 200, { segments })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-kb] listening on http://127.0.0.1:${port}`)
})
