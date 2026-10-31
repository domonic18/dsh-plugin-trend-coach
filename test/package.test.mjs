import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('dsh 版本门禁与 peer 精确对齐', () => {
  assert.equal(pkg.engines.dsh, '>=0.2.1-rc.5 <0.3.0')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-credentials'], pkg.devDependencies['@deepseek-ai/dsh-credentials'])
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-tools'], '0.2.1-rc.5')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'], '0.2.1-rc.5')
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '~4.0.5')
  assert.equal(pkg.peerDependencies['@deepseek-ai/schemastery'], '~3.18.5')
})

test('发布包只含运行时产物', () => {
  const output = execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  )
  const packed = JSON.parse(output)[0]
  const files = packed.files.map((file) => file.path)

  for (const required of [
    'package.json',
    'cordis.patch.yml',
    'lib/index.js',
    'lib/index.d.ts',
    'lib/client.js',
    'lib/client/index.d.ts',
  ]) {
    assert.equal(files.includes(required), true, `缺少 ${required}`)
  }

  for (const file of files) {
    assert.equal(/^(?!lib\/|package\.json$|cordis\.patch\.yml$)/.test(file), false, `不应发布 ${file}`)
  }

  assert.equal(files.some((file) => /\.(env|pem|key|p12|tgz)$/i.test(file)), false)
})
