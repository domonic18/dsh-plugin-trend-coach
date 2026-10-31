import { createServer } from 'node:http'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures.json', import.meta.url)), 'utf8'),
)

const port = Number(process.env.MOCK_KB_PORT ?? 3939)

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

const mediaFile = fileURLToPath(new URL('./media/lesson.mp4', import.meta.url))

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
    return
  }

  if (request.method === 'GET' && request.url === '/media/lesson.mp4') {
    const total = statSync(mediaFile).size
    const range = request.headers.range
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

  if (request.method === 'GET' && request.url.startsWith('/v1/kb/segments/')) {
    const segmentId = decodeURIComponent(request.url.slice('/v1/kb/segments/'.length))
    const segment = fixtures.find(item => item.segmentId === segmentId)
    if (segment === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'segment not found' }))
      return
    }
    const { keywords: _keywords, ...publicSegment } = segment
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ...publicSegment, score: 1 }))
    return
  }

  if (request.method !== 'POST' || request.url !== '/v1/kb/search') {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)

  let payload
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'invalid json' }))
    return
  }

  const query = payload?.query
  if (typeof query !== 'string' || query.trim() === '') {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'query is required' }))
    return
  }

  const topK = Number.isInteger(payload.topK) ? Math.min(Math.max(payload.topK, 1), 20) : 5
  const segments = search({ query, courseId: payload.courseId, topK })

  console.log(`[mock-kb] query=${JSON.stringify(query)} hits=${segments.length}`)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ segments }))
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-kb] listening on http://127.0.0.1:${port}`)
})
