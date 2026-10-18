import { expect, it } from 'vitest'
import { externalUrl } from '../apps/desktop/external-link'

it('passes plain web links on to the browser', () => {
  expect(externalUrl('https://platform.deepseek.com/api_keys')).toBe('https://platform.deepseek.com/api_keys')
  expect(externalUrl('http://example.com')).toBe('http://example.com/')
  expect(externalUrl('HTTPS://Example.com/a b')).toBe('https://example.com/a%20b')
})

it('drops everything else', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<b>hi</b>', 'vscode://file/x', 'ccswitch://v1/import?x=1', 'mailto:a@b.c', '//example.com', 'not a url', ''])
    expect(externalUrl(url)).toBeUndefined()
})
