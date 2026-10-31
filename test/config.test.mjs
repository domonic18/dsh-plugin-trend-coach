import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCAL_BASE_URL, resolveConfig } from '../lib/host/config.js'

function config(overrides = {}) {
  return {
    environment: 'local',
    baseUrl: LOCAL_BASE_URL,
    apiTokenRef: { get: () => 'test-token' },
    timeoutMs: 10_000,
    voiceTimeoutMs: 40_000,
    logLevel: 'warn',
    ...overrides,
  }
}

test('local 环境允许 http 并规范化尾部斜杠', () => {
  const resolved = resolveConfig(config({ baseUrl: 'http://127.0.0.1:3939///' }))
  assert.equal(resolved.baseUrl, 'http://127.0.0.1:3939')
})

test('staging/production 强制 HTTPS', () => {
  assert.throws(
    () => resolveConfig(config({ environment: 'staging', baseUrl: 'http://api.example.com' })),
    /HTTPS/,
  )
  assert.equal(
    resolveConfig(config({ environment: 'staging', baseUrl: 'https://api.example.com' })).environment,
    'staging',
  )
  assert.equal(
    resolveConfig(config({ environment: 'production', baseUrl: 'https://api.example.com' })).environment,
    'production',
  )
})

test('production 拒绝本机地址', () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', 'api.localhost', '[::1]', '0.0.0.0']) {
    assert.throws(
      () => resolveConfig(config({ environment: 'production', baseUrl: `https://${host}` })),
      /本机地址/,
    )
  }
})

test('非法 environment/logLevel/timeoutMs 直接拒绝', () => {
  assert.throws(() => resolveConfig(config({ environment: 'dev' })), /environment/)
  assert.throws(() => resolveConfig(config({ logLevel: 'trace' })), /logLevel/)
  assert.throws(() => resolveConfig(config({ timeoutMs: 0 })), /timeoutMs/)
  assert.throws(() => resolveConfig(config({ timeoutMs: Number.NaN })), /timeoutMs/)
  assert.throws(() => resolveConfig(config({ voiceTimeoutMs: 0 })), /voiceTimeoutMs/)
  assert.throws(() => resolveConfig(config({ voiceTimeoutMs: Number.NaN })), /voiceTimeoutMs/)
})

test('baseUrl 拒绝非法协议、账号密码与查询串', () => {
  assert.throws(() => resolveConfig(config({ baseUrl: 'not-a-url' })), /合法 URL/)
  assert.throws(() => resolveConfig(config({ baseUrl: 'ftp://api.example.com' })), /http\/https/)
  assert.throws(() => resolveConfig(config({ baseUrl: 'https://user:pass@api.example.com' })), /账号密码/)
  assert.throws(() => resolveConfig(config({ baseUrl: 'https://api.example.com?token=1' })), /查询串/)
})
