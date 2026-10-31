import type { Logger } from '@deepseek-ai/cordis'
import type { LogLevel } from './config.js'

const RANK: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

export interface HostLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

/** 按配置过滤日志级别；默认 warn 只保留失败信息，避免正常请求刷屏。 */
export function createHostLogger(logger: Logger, level: LogLevel): HostLogger {
  const allows = (target: Exclude<LogLevel, 'silent'>) => RANK[level] >= RANK[target]
  return {
    info: (message, ...args) => {
      if (allows('info')) logger.info(message, ...args)
    },
    warn: (message, ...args) => {
      if (allows('warn')) logger.warn(message, ...args)
    },
    debug: (message, ...args) => {
      if (allows('debug')) logger.debug(message, ...args)
    },
  }
}
