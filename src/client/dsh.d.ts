import type { Context } from '@deepseek-ai/cordis'
import type {
  AuthStatus,
  DeviceAuthPoll,
  DeviceAuthStart,
  PlaybackSession,
  SearchResult,
  Segment,
} from '../shared/contracts.js'

export type RemoteSearchResult =
  | { ok: true; value: SearchResult }
  | { ok: false; error: { code: string; message: string } }

export type RemoteSegmentResult =
  | { ok: true; value: Segment }
  | { ok: false; error: { code: string; message: string } }

export type RemotePlaybackResult =
  | { ok: true; value: PlaybackSession }
  | { ok: false; error: { code: string; message: string } }

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
