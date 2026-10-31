// 云端文本一律按不可信数据渲染：固定边界 + 转义，避免正文伪造边界跳出资料区。
const BOUNDARY_TOKEN = /<\/?course_segment_data/gi

export const SEGMENT_DATA_OPEN = '<course_segment_data>'
export const SEGMENT_DATA_CLOSE = '</course_segment_data>'

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

export function wrapUntrusted(value: string): string {
  return `${SEGMENT_DATA_OPEN}\n${sanitizeUntrusted(value)}\n${SEGMENT_DATA_CLOSE}`
}
