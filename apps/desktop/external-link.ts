/**
 * The URL to hand to the user's default browser, or undefined to drop it. Only plain web links (http and https)
 * leave the app; file:, javascript:, data: and custom schemes that could launch other programs never do. With `page`
 * (the app's own URL), links back into the app itself are dropped too, so a dev-server page never opens in the browser.
 */
export function externalUrl(url: string, page?: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return undefined
    if (page && URL.canParse(page) && new URL(page).origin === parsed.origin)
      return undefined
    return parsed.href
  }
  catch {
    return undefined
  }
}
