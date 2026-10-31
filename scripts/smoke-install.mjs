import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 在临时 DSH_HOME 中安装打包产物，验证全新 profile 能装上插件。
const DSH_VERSION = '0.2.1-rc.5'
const PROFILE = 'smoke'
const PLUGIN = 'dsh-plugin-trend-coach'

const home = await mkdtemp(join(tmpdir(), 'dsh-smoke-'))
let tarball
try {
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts'], { encoding: 'utf8' }),
  )[0]
  tarball = join(process.cwd(), packed.filename)
  console.log(`安装 ${packed.filename} 到临时 profile（DSH_HOME=${home}）`)

  execFileSync(
    'npx',
    ['--yes', `@deepseek-ai/dsh@${DSH_VERSION}`, 'plugin', '--profile', PROFILE, 'add', '-w', tarball],
    { stdio: 'inherit', env: { ...process.env, DSH_HOME: home } },
  )

  const manifest = JSON.parse(await readFile(join(home, 'profiles', PROFILE, 'package.json'), 'utf8'))
  if (manifest.dependencies?.[PLUGIN] === undefined) {
    throw new Error(`安装后 ${PROFILE} profile 未声明 ${PLUGIN}`)
  }
  const bundles = manifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes(PLUGIN)) {
    throw new Error(`安装后 ${PROFILE} profile 未启用 ${PLUGIN} bundle`)
  }
  console.log(`冒烟通过：${PROFILE} profile 已安装并启用 ${PLUGIN}`)
} finally {
  if (tarball !== undefined) await rm(tarball, { force: true })
  await rm(home, { recursive: true, force: true })
}
