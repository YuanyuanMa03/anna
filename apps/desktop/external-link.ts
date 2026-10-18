/**
 * The URL to hand to the user's default browser, or undefined to drop it. Only plain web links (http and https)
 * leave the app; file:, javascript:, data: and custom schemes that could launch other programs never do.
 */
export function externalUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined
  }
  catch {
    return undefined
  }
}
