import { expect, it } from 'vitest'
import { renderMarkdown } from '../packages/character/markdown'

it('renders the subset Anna uses and never passes HTML through', () => {
  const html = renderMarkdown('**完成了**\n\n- 改了 `a.ts`\n- 测试通过\n1. 第一步\n```\n<script>x</script>\n```\n<img src=x onerror=alert(1)>')
  expect(html).toContain('<p><strong>完成了</strong></p>')
  expect(html).toContain('<ul><li>改了 <code>a.ts</code></li><li>测试通过</li></ul><ol><li>第一步</li></ol>')
  expect(html).toContain('<pre>&lt;script&gt;x&lt;/script&gt;</pre>')
  expect(html).not.toContain('<img')
})
