import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('./media/hls/', import.meta.url))
const playlist = `${dir}index.m3u8`
const fixturesPath = fileURLToPath(new URL('./fixtures.json', import.meta.url))
const force = process.argv.includes('--force')

if (existsSync(playlist) && !force) {
  console.log(`[build-hls] reuse ${playlist}`)
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
const key = randomBytes(16)
const iv = randomBytes(16)
const keyPath = `${dir}enc.key`
const keyInfoPath = `${dir}keyinfo.tmp`

writeFileSync(keyPath, key)
writeFileSync(keyInfoPath, `enc.key\n${keyPath}\n${iv.toString('hex')}\n`)

// 样片必须覆盖 fixtures 里最靠后的片段，否则定位到片尾会直接结束。
const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'))
const lastEnd = Math.max(...fixtures.map((segment) => segment.endSec))
const duration = Math.ceil(lastEnd + 15)

// 1fps 低码率样片，只为验证加密 HLS 与长视频定位；不是课程素材。
const ffmpeg = spawnSync('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=1',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=22050',
  '-t', String(duration),
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-g', '8',
  '-c:a', 'aac', '-b:a', '24k',
  '-f', 'hls',
  '-hls_time', '4',
  '-hls_playlist_type', 'vod',
  '-hls_key_info_file', keyInfoPath,
  '-hls_segment_filename', `${dir}seg%04d.ts`,
  playlist,
], { stdio: 'inherit' })

rmSync(keyInfoPath, { force: true })
if (ffmpeg.status !== 0) {
  console.error('[build-hls] ffmpeg failed')
  process.exit(ffmpeg.status ?? 1)
}
console.log(`[build-hls] wrote ${playlist}`)
