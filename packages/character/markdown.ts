/** Minimal, escape-first Markdown for Anna's speech bubble: headings, lists, bold, inline and fenced code. No links or raw HTML. */
export function renderMarkdown(source: string) {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const inline = (text: string) => escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  const out: string[] = []
  let list: 'ul' | 'ol' | undefined
  let fence: string[] | undefined
  const closeList = () => { if (list) { out.push(`</${list}>`); list = undefined } }
  for (const line of source.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (fence) { out.push(`<pre>${escape(fence.join('\n'))}</pre>`); fence = undefined }
      else { closeList(); fence = [] }
      continue
    }
    if (fence) { fence.push(line); continue }
    const heading = /^#{1,6} (\S.*)$/.exec(line)
    const bullet = /^ *[-*] (\S.*)$/.exec(line)
    const numbered = /^ *\d+[.)] (\S.*)$/.exec(line)
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind }
      out.push(`<li>${inline((bullet ?? numbered)![1]!)}</li>`)
      continue
    }
    closeList()
    if (heading)
      out.push(`<h4>${inline(heading[1]!)}</h4>`)
    else if (line.trim())
      out.push(`<p>${inline(line)}</p>`)
  }
  if (fence)
    out.push(`<pre>${escape(fence.join('\n'))}</pre>`)
  closeList()
  return out.join('')
}
