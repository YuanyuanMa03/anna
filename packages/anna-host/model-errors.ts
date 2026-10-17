/** Provider and network failures in plain words, and whether they mean the key itself was refused. */
export interface ModelError { message: string, keyRejected: boolean }

/**
 * Patterns are matched against the first line of the error. Only provider status codes and wording count as a refused
 * key, so a local failure such as `EACCES: permission denied` never marks a working key as rejected.
 */
const patterns: [RegExp, string, boolean][] = [
  [/\b401\b|authentication[_ ]?(?:error|fail)|unauthori[sz]ed|invalid[_ ]?(?:api[_ ]?)?key|incorrect api key/i, 'API Key 无效或已过期，服务商拒绝了它。请在“模型与设置”里换一个密钥。', true],
  [/\b403\b/, '服务商拒绝了这次请求：这个密钥没有权限使用该模型。请检查密钥或模型 ID。', true],
  [/\b402\b|insufficient[_ ](?:balance|quota|funds)|余额不足|payment required/i, '模型账户余额或额度不足，请到服务商那里充值后再试。', false],
  [/\b429\b|rate[_ ]?limit|too many requests/i, '请求太频繁或超出额度，服务商暂时拒绝了。稍等一会儿再试。', false],
  [/\b404\b.+model|model.*(?:not (?:found|exist)|does not exist)/i, '服务商找不到这个模型。请在“模型与设置”里检查模型 ID。', false],
  [/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network error|socket hang up|getaddrinfo/i, '连不上模型服务。请检查网络、代理或 API 端点地址。', false],
  [/\b(?:500|502|503|504|529)\b|overloaded|service unavailable|internal server error/i, '模型服务暂时出错了，不是你的问题，稍后再试。', false],
]

export function describeModelError(raw: string): ModelError {
  const detail = raw.replace(/\s+/g, ' ').trim()
  const excerpt = detail.length > 140 ? `${detail.slice(0, 140)}…` : detail
  for (const [pattern, message, keyRejected] of patterns) {
    if (pattern.test(detail))
      return { message: `${message}（原始信息：${excerpt}）`, keyRejected }
  }
  return { message: excerpt, keyRejected: false }
}
