/** 日志与持久错误只保留 scheme/host/path；签名 query、fragment 与凭据永不外泄。 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return '<redacted-credentials>'
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return '<malformed>'
  }
}
