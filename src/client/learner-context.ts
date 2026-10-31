import {
  bucketPosition,
  clipSelectedText,
  sceneKey,
  selectionScopeKey,
  type LearnerContextState,
  type LearnerScene,
} from './context-model.js'

const ENABLED_STORAGE_KEY = 'trend-coach.learner-context.enabled'

function readEnabled(): boolean {
  try {
    const value = globalThis.localStorage?.getItem(ENABLED_STORAGE_KEY)
    return value === null || value === undefined ? true : value !== '0'
  } catch {
    return true
  }
}

function persistEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(ENABLED_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // localStorage 不可用时只在本次会话生效。
  }
}

function withPosition(scene: LearnerScene, current: LearnerScene | undefined): LearnerScene {
  const positionSec = scene.positionSec
    ?? (current !== undefined && current.segmentId === scene.segmentId ? current.positionSec : undefined)
  return {
    courseId: scene.courseId,
    ...(scene.courseTitle === undefined ? {} : { courseTitle: scene.courseTitle }),
    ...(scene.chapterId === undefined ? {} : { chapterId: scene.chapterId }),
    ...(scene.chapterTitle === undefined ? {} : { chapterTitle: scene.chapterTitle }),
    ...(scene.knowledgePointId === undefined ? {} : { knowledgePointId: scene.knowledgePointId }),
    ...(scene.knowledgePointTitle === undefined ? {} : { knowledgePointTitle: scene.knowledgePointTitle }),
    ...(scene.segmentId === undefined ? {} : { segmentId: scene.segmentId }),
    ...(positionSec === undefined ? {} : { positionSec }),
  }
}

/** 学习场景是全局 UI 状态：多个会话各自发布同一份快照，不做会话隔离。 */
export class LearnerContextClientStore {
  private state: LearnerContextState
  private readonly listeners = new Set<() => void>()

  constructor(options: { enabled?: boolean } = {}) {
    this.state = {
      enabled: options.enabled ?? readEnabled(),
      revision: 0,
    }
  }

  getSnapshot = (): LearnerContextState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.state.enabled === enabled) return
    persistEnabled(enabled)
    this.commit({ ...this.state, enabled })
  }

  setScene(scene: LearnerScene): void {
    const current = this.state.scene
    const next = withPosition(scene, current)
    if (current !== undefined && sceneKey(current) === sceneKey(next)
      && current.courseTitle === next.courseTitle
      && current.chapterTitle === next.chapterTitle
      && current.knowledgePointTitle === next.knowledgePointTitle) {
      return
    }
    const scoped = current !== undefined && selectionScopeKey(current) === selectionScopeKey(next)
    this.commit({
      ...this.state,
      scene: next,
      ...(scoped ? {} : { selectedText: undefined }),
    })
  }

  clearScene(): void {
    if (this.state.scene === undefined) return
    this.commit({ ...this.state, scene: undefined, selectedText: undefined })
  }

  /** 只有当前场景仍是该片段时才接受播放位置，避免后台播放覆盖正在阅读的知识点。 */
  updatePosition(segmentId: string, positionSec: number): void {
    const scene = this.state.scene
    if (scene === undefined || scene.segmentId === undefined || scene.segmentId !== segmentId) return
    const bucketed = bucketPosition(positionSec)
    if (scene.positionSec === bucketed) return
    this.commit({ ...this.state, scene: { ...scene, positionSec: bucketed } })
  }

  setSelectedText(value: string): void {
    const text = clipSelectedText(value)
    if (text.trim().length === 0) {
      this.clearSelectedText()
      return
    }
    if (this.state.selectedText === text) return
    this.commit({ ...this.state, selectedText: text })
  }

  clearSelectedText(): void {
    if (this.state.selectedText === undefined) return
    this.commit({ ...this.state, selectedText: undefined })
  }

  clear(): void {
    if (this.state.scene === undefined && this.state.selectedText === undefined) return
    this.commit({ ...this.state, scene: undefined, selectedText: undefined })
  }

  private commit(next: Omit<LearnerContextState, 'revision'>): void {
    this.state = { ...next, revision: this.state.revision + 1 }
    for (const listener of this.listeners) listener()
  }
}

export const learnerContextStore = new LearnerContextClientStore()
