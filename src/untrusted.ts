// 云端文本与学员选中文本一律按不可信数据渲染：固定边界 + 转义，避免伪造边界跳出资料区。
const BOUNDARY_TOKEN = /<\/?(?:course_segment_data|trend_coach_learner_context|learner_selected_text)/gi

export const SEGMENT_DATA_OPEN = '<course_segment_data>'
export const SEGMENT_DATA_CLOSE = '</course_segment_data>'
export const LEARNER_CONTEXT_OPEN = '<trend_coach_learner_context>'
export const LEARNER_CONTEXT_CLOSE = '</trend_coach_learner_context>'
export const LEARNER_TEXT_OPEN = '<learner_selected_text>'
export const LEARNER_TEXT_CLOSE = '</learner_selected_text>'

function stripControlChars(value: string): string {
  let result = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    const keep = code === 9 || code === 10 || code === 13
      || (code >= 32 && code !== 127)
    if (keep) result += char
  }
  return result
}

export function sanitizeUntrusted(value: string): string {
  return stripControlChars(value)
    .replace(BOUNDARY_TOKEN, (match) => match.replace('<', '＜'))
}

export function sanitizeInlineUntrusted(value: string): string {
  return sanitizeUntrusted(value).replace(/[\t\n\r]+/g, ' ')
}

/** 语音转写是用户草稿，只需压平空白；不做边界 token 转义，避免误改正常文字。 */
export function sanitizeVoiceText(value: string): string {
  return stripControlChars(value).replace(/\s+/g, ' ').trim()
}

export function truncateCodePoints(value: string, max: number): string {
  if (max <= 0) return ''
  let result = ''
  let count = 0
  for (const char of value) {
    if (count >= max) break
    result += char
    count += 1
  }
  return result
}

export function wrapUntrusted(value: string): string {
  return `${SEGMENT_DATA_OPEN}\n${sanitizeUntrusted(value)}\n${SEGMENT_DATA_CLOSE}`
}

export function wrapLearnerText(value: string): string {
  return `${LEARNER_TEXT_OPEN}\n${sanitizeUntrusted(value)}\n${LEARNER_TEXT_CLOSE}`
}
