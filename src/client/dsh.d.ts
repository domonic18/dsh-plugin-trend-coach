import type { Context } from '@deepseek-ai/cordis'

export interface SearchSegment {
  segmentId: string
  courseId: string
  chapterId: string
  knowledgePointId: string
  title: string
  startSec: number
  endSec: number
  text: string
  score: number
}

export interface SearchPayload {
  query: string
  segments: SearchSegment[]
}

export type RemoteSearchResult =
  | { ok: true; value: SearchPayload }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSegmentResult =
  | { ok: true; value: SearchSegment }
  | { ok: false; error: { code: string; message: string } }

export interface PlaybackSession {
  sessionId: string
  playlistUrl: string
  expiresAt: number
  watermark?: { label: string }
}

export type RemotePlaybackResult =
  | { ok: true; value: PlaybackSession }
  | { ok: false; error: { code: string; message: string } }

export interface AuthStatus {
  mode: 'device' | 'credential' | 'none'
  authorized: boolean
  deviceId?: string
}

export interface DeviceAuthStart {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface DeviceAuthPoll {
  status: 'pending' | 'authorized' | 'expired'
}

export type RemoteAuthStatusResult =
  | { ok: true; value: AuthStatus }
  | { ok: false; error: { code: string; message: string } }

export type RemoteDeviceAuthStartResult =
  | { ok: true; value: DeviceAuthStart }
  | { ok: false; error: { code: string; message: string } }

export type RemoteDeviceAuthPollResult =
  | { ok: true; value: DeviceAuthPoll }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSignOutResult =
  | { ok: true; value: { signedOut: true } }
  | { ok: false; error: { code: string; message: string } }

interface SlotsService {
  inject(key: string, callback: () => void | (() => void)): void
  register(options: Record<string, unknown>, component: unknown): () => void
}

interface SidebarRightTabsService {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: Array<{
      id: string
      order: number
      title: () => string
      description?: () => string
    }>
  }): () => void
}

interface SidebarRightService {
  openTab(kind: string, options?: { params?: Record<string, unknown> }): void
  openResource(address: string, options?: { params?: Record<string, unknown> }): void
}

interface ClientRemoteService {
  $mount(contribution: unknown): Promise<() => Promise<void>>
  trendCoach: {
    search(query: string, topK: number): Promise<RemoteSearchResult>
    getSegment(segmentId: string): Promise<RemoteSegmentResult>
    createPlaybackSession(segmentId: string): Promise<RemotePlaybackResult>
    authStatus(): Promise<RemoteAuthStatusResult>
    beginDeviceAuth(): Promise<RemoteDeviceAuthStartResult>
    pollDeviceAuth(): Promise<RemoteDeviceAuthPollResult>
    signOut(): Promise<RemoteSignOutResult>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService
    sidebarRightTabs: SidebarRightTabsService
    sidebarRight: SidebarRightService
    remote: ClientRemoteService
  }
}
