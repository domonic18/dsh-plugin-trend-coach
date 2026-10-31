import Schema from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

export const LOCAL_BASE_URL = 'http://127.0.0.1:3939'

export const ENVIRONMENTS = ['local', 'staging', 'production'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export interface Config {
  environment: Environment
  baseUrl: string
  apiTokenRef: Volatile<string>
  timeoutMs: number
  voiceTimeoutMs: number
  logLevel: LogLevel
}

function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value)
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value)
}

function envOrDefault(): Environment {
  const value = process.env.TREND_COACH_ENV
  return value !== undefined && isEnvironment(value) ? value : 'local'
}

function logLevelOrDefault(): LogLevel {
  const value = process.env.TREND_COACH_LOG_LEVEL
  return value !== undefined && isLogLevel(value) ? value : 'warn'
}

export const Config = Schema.object({
  environment: Schema.string().default(envOrDefault()),
  baseUrl: Schema.string().default(process.env.TREND_COACH_BASE_URL?.trim() || LOCAL_BASE_URL),
  apiTokenRef: Schema.string().role('credential-ref').default('TREND_COACH_API_TOKEN').volatile(),
  timeoutMs: Schema.number().default(10_000),
  // 语音要大于云端 ASR_TIMEOUT_MS（默认 30s），让云端先返回可读错误。
  voiceTimeoutMs: Schema.number().default(40_000),
  logLevel: Schema.string().default(logLevelOrDefault()),
})

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname === '0.0.0.0'
    || /^127\./.test(hostname)
}

/** 校验并规范化配置；失败直接阻止插件激活，避免用错误地址静默请求。 */
export function resolveConfig(input: Config): Config {
  if (!isEnvironment(input.environment)) {
    throw new Error(`trend-coach: environment 必须是 ${ENVIRONMENTS.join('/')}`)
  }
  if (!isLogLevel(input.logLevel)) {
    throw new Error(`trend-coach: logLevel 必须是 ${LOG_LEVELS.join('/')}`)
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error('trend-coach: timeoutMs 必须是正数')
  }
  if (!Number.isFinite(input.voiceTimeoutMs) || input.voiceTimeoutMs <= 0) {
    throw new Error('trend-coach: voiceTimeoutMs 必须是正数')
  }

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('trend-coach: baseUrl 不是合法 URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('trend-coach: baseUrl 仅支持 http/https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('trend-coach: baseUrl 不得包含账号密码')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error('trend-coach: baseUrl 不得包含查询串或锚点')
  }
  if (input.environment !== 'local' && url.protocol !== 'https:') {
    throw new Error('trend-coach: staging/production 必须使用 HTTPS')
  }
  if (input.environment === 'production' && isLoopback(url.hostname)) {
    throw new Error('trend-coach: production 不允许指向本机地址')
  }

  return { ...input, baseUrl }
}
