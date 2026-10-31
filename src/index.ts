import type { Context } from '@deepseek-ai/cordis'
import { AuthManager } from './auth.js'
import { Config, resolveConfig } from './host/config.js'
import { EventReporter } from './host/events.js'
import { CourseSessionTracker, registerFeedbackBridge } from './host/feedback.js'
import { LearnerContextStore, registerLearnerContext } from './host/learner-context.js'
import { createHostLogger } from './host/log.js'
import { TrendCoachService } from './host/service.js'
import { registerSearchTool } from './host/tool.js'

export { Config }

export const name = 'trend-coach'

export const inject = ['tools', 'credentials', 'systemPrompt']

export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const logger = createHostLogger(ctx.logger('trend-coach'), resolved.logLevel)
  const auth = new AuthManager(ctx, resolved)
  const events = new EventReporter(auth, logger)
  const learnerContext = new LearnerContextStore()

  const tracker = new CourseSessionTracker()

  registerLearnerContext(ctx, learnerContext)
  new TrendCoachService(ctx, auth, logger, events, learnerContext, resolved.voiceTimeoutMs)
  registerSearchTool(ctx, auth, events, tracker)
  registerFeedbackBridge(ctx, events, tracker)

  logger.info(
    'trend-coach 已激活: environment=%s baseUrl=%s timeoutMs=%d logLevel=%s',
    resolved.environment,
    resolved.baseUrl,
    resolved.timeoutMs,
    resolved.logLevel,
  )
}
