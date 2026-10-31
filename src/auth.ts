import { randomBytes } from 'node:crypto'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import {
  credentialKey,
  credentialRef,
  type CredentialProvider,
  type CredentialRecord,
} from '@deepseek-ai/dsh-credentials'
import { AuthError, readJsonResponse } from './errors.js'
import type { AuthStatus, DeviceAuthPoll, DeviceAuthStart } from './shared/contracts.js'

export type { AuthStatus, DeviceAuthPoll, DeviceAuthStart } from './shared/contracts.js'

export interface AuthConfig {
  baseUrl: string
  timeoutMs: number
  apiTokenRef: Volatile<string>
}

interface DeviceGrant {
  accessToken: string
  refreshToken: string
  expiresAt: number
  deviceId: string
}

interface TokenState {
  token: string
  deviceId?: string
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`授权服务返回 HTTP ${status}`)
    this.name = 'HttpError'
  }
}

const CLIENT_ID = 'dsh-plugin-trend-coach'
const GRANT_KEY = credentialKey('trend-coach', 'device')
const NO_SIGNAL = new AbortController().signal
// 提前刷新，避免请求途中令牌过期。
const REFRESH_MARGIN_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDeviceGrant(value: unknown): value is DeviceGrant {
  if (!isRecord(value)) return false
  return (
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'number' &&
    typeof value.deviceId === 'string'
  )
}

function grantOf(record: CredentialRecord | undefined): DeviceGrant | undefined {
  if (record?.kind !== 'grant' || !isRecord(record.payload)) return undefined
  return isDeviceGrant(record.payload) ? record.payload : undefined
}

function isDeviceCodeResponse(
  value: unknown,
): value is {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
} {
  if (!isRecord(value)) return false
  return (
    typeof value.deviceCode === 'string' &&
    typeof value.userCode === 'string' &&
    typeof value.verificationUri === 'string' &&
    typeof value.expiresIn === 'number' &&
    value.expiresIn > 0 &&
    typeof value.interval === 'number' &&
    value.interval > 0
  )
}

function isDeviceTokenResponse(
  value: unknown,
): value is { status: 'pending' | 'expired' } | { status: 'authorized'; grant: DeviceGrant } {
  if (!isRecord(value)) return false
  if (value.status === 'pending' || value.status === 'expired') return true
  return value.status === 'authorized' && isDeviceGrant(value.grant)
}

export class AuthManager {
  private readonly credentials: CredentialProvider
  private pending?: { deviceCode: string; expiresAt: number }
  private refreshInFlight?: Promise<void>

  constructor(
    ctx: Context,
    private readonly config: AuthConfig,
  ) {
    const credentials = ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) {
      throw new Error('trend-coach: 缺少 credentials 服务，无法解析授权凭据')
    }
    this.credentials = credentials
  }

  async status(): Promise<AuthStatus> {
    const grant = await this.readGrant()
    if (grant !== undefined) {
      return { mode: 'device', authorized: true, deviceId: grant.deviceId }
    }
    const hit = await this.credentials.resolve(credentialRef(this.config.apiTokenRef.get()))
    if (hit !== undefined) return { mode: 'credential', authorized: true }
    return { mode: 'none', authorized: false }
  }

  async beginDeviceAuth(signal: AbortSignal): Promise<DeviceAuthStart> {
    const payload = await this.postJson(
      '/v1/auth/device/code',
      { clientId: CLIENT_ID, deviceId: randomBytes(12).toString('hex') },
      signal,
    )
    if (!isDeviceCodeResponse(payload)) {
      throw new Error('授权服务返回了不合法的设备码响应')
    }
    const expiresAt = Date.now() + payload.expiresIn * 1000
    this.pending = { deviceCode: payload.deviceCode, expiresAt }
    return {
      userCode: payload.userCode,
      verificationUri: payload.verificationUri,
      expiresAt,
      interval: payload.interval,
    }
  }

  async pollDeviceAuth(signal: AbortSignal): Promise<DeviceAuthPoll> {
    const pending = this.pending
    if (pending === undefined) return { status: 'expired' }
    if (Date.now() >= pending.expiresAt) {
      this.pending = undefined
      return { status: 'expired' }
    }

    const payload = await this.postJson(
      '/v1/auth/device/token',
      { deviceCode: pending.deviceCode },
      signal,
    )
    if (!isDeviceTokenResponse(payload)) {
      throw new Error('授权服务返回了不合法的设备令牌响应')
    }
    if (payload.status === 'authorized') {
      await this.credentials.modifyRecord(GRANT_KEY, async () => ({
        kind: 'grant',
        payload: payload.grant,
      }))
      this.pending = undefined
      return { status: 'authorized' }
    }
    if (payload.status === 'expired') this.pending = undefined
    return { status: payload.status }
  }

  async signOut(): Promise<void> {
    this.pending = undefined
    const grant = await this.readGrant()
    if (grant !== undefined) {
      try {
        const response = await this.request('/v1/auth/revoke', { method: 'POST' }, NO_SIGNAL)
        await response.body?.cancel()
      } catch {
        // 服务端吊销尽力而为；本地登出不因网络失败而中断。
      }
    }
    await this.credentials.deleteRecord(GRANT_KEY)
  }

  /** 带授权的取数请求；401 时用 refresh token 轮换一次后重试。 */
  async request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
    timeoutMs = this.config.timeoutMs,
  ): Promise<Response> {
    const first = await this.accessToken()
    const response = await this.send(path, init, first, signal, timeoutMs)
    if (response.status !== 401 && response.status !== 403) return response

    await response.body?.cancel()
    if (first.deviceId === undefined) {
      throw new AuthError('授权已失效，请重新设备授权', 'AUTH_EXPIRED')
    }
    if (response.status === 403) {
      throw new AuthError('设备授权与当前设备不匹配，请重新登录', 'DEVICE_MISMATCH')
    }

    await this.refresh(true)
    const second = await this.accessToken()
    const retry = await this.send(path, init, second, signal, timeoutMs)
    if (retry.status === 401 || retry.status === 403) {
      await retry.body?.cancel()
      throw new AuthError('授权已失效，请重新设备授权', 'AUTH_EXPIRED')
    }
    return retry
  }

  private async readGrant(): Promise<DeviceGrant | undefined> {
    return grantOf(await this.credentials.readRecord(GRANT_KEY))
  }

  private async accessToken(): Promise<TokenState> {
    const grant = await this.readGrant()
    if (grant !== undefined) {
      if (grant.expiresAt - Date.now() <= REFRESH_MARGIN_MS) {
        await this.refresh(false)
      }
      const current = (await this.readGrant()) ?? grant
      return { token: current.accessToken, deviceId: current.deviceId }
    }

    const hit = await this.credentials.resolve(credentialRef(this.config.apiTokenRef.get()))
    if (hit === undefined) {
      throw new AuthError('尚未登录，请先在趋势伴学面板完成设备授权', 'UNAUTHORIZED')
    }
    return { token: hit.value }
  }

  private async refresh(force: boolean): Promise<void> {
    if (this.refreshInFlight === undefined) {
      this.refreshInFlight = this.doRefresh(force).finally(() => {
        this.refreshInFlight = undefined
      })
    }
    return this.refreshInFlight
  }

  private async doRefresh(force: boolean): Promise<void> {
    await this.credentials.modifyRecord(GRANT_KEY, async (current) => {
      const grant = grantOf(current)
      if (grant === undefined) return undefined
      if (!force && grant.expiresAt - Date.now() > REFRESH_MARGIN_MS) return undefined

      let payload: unknown
      try {
        payload = await this.postJson(
          '/v1/auth/refresh',
          { refreshToken: grant.refreshToken, deviceId: grant.deviceId },
          undefined,
        )
      } catch (error) {
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          throw new AuthError('登录已过期，请重新设备授权', 'AUTH_EXPIRED')
        }
        throw error
      }
      if (!isDeviceGrant(payload)) {
        throw new AuthError('登录已过期，请重新设备授权', 'AUTH_EXPIRED')
      }
      return { kind: 'grant', payload }
    })
  }

  private async send(
    path: string,
    init: RequestInit,
    state: TokenState,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${state.token}`)
    if (state.deviceId !== undefined) headers.set('x-device-id', state.deviceId)
    return await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
  }

  private async postJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const signals = [AbortSignal.timeout(this.config.timeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    })
    if (!response.ok) throw new HttpError(response.status)
    return await readJsonResponse(response, '授权服务')
  }
}
