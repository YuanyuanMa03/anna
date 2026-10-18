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

it('keeps links back into the app itself out of the browser', () => {
  expect(externalUrl('http://127.0.0.1:5193/settings', 'http://127.0.0.1:5193/')).toBeUndefined()
  expect(externalUrl('https://platform.deepseek.com/api_keys', 'http://127.0.0.1:5193/')).toBe('https://platform.deepseek.com/api_keys')
  expect(externalUrl('https://example.com/', 'file:///Applications/Anna.app/dist/renderer/index.html')).toBe('https://example.com/')
})
