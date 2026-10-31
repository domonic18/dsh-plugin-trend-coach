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
