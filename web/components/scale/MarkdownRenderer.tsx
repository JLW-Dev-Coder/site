'use client'

// ---------------------------------------------------------------------------
// Lightweight markdown renderer
// Handles: headings (#-######), bold/italic, code (``` and inline `),
// tables, links, ordered/unordered lists, horizontal rules, blockquotes.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safeUrl = url.replace(/"/g, '%22')
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  return out
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  let inUl = false
  let inOl = false
  let inBq = false
  let paraBuf: string[] = []

  const flushPara = () => {
    if (paraBuf.length === 0) return
    out.push(`<p>${renderInline(paraBuf.join(' '))}</p>`)
    paraBuf = []
  }
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false }
    if (inOl) { out.push('</ol>'); inOl = false }
  }
  const closeBq = () => {
    if (inBq) { out.push('</blockquote>'); inBq = false }
  }
  const closeAll = () => {
    flushPara()
    closeLists()
    closeBq()
  }

  while (i < lines.length) {
    const line = lines[i]

    const fence = line.match(/^```(\w*)\s*$/)
    if (fence) {
      closeAll()
      const lang = fence[1] || ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      i++
      const langClass = lang ? ` class="lang-${lang}"` : ''
      out.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (/^\s*(\*\s*){3,}\s*$/.test(line) || /^\s*(-\s*){3,}\s*$/.test(line) || /^\s*(_\s*){3,}\s*$/.test(line)) {
      closeAll()
      out.push('<hr />')
      i++
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeAll()
      const level = h[1].length
      out.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`)
      i++
      continue
    }

    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      closeAll()
      const splitRow = (row: string) =>
        row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const headers = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]))
        i++
      }
      out.push('<table><thead><tr>')
      for (const hdr of headers) out.push(`<th>${renderInline(hdr)}</th>`)
      out.push('</tr></thead><tbody>')
      for (const r of rows) {
        out.push('<tr>')
        for (const c of r) out.push(`<td>${renderInline(c)}</td>`)
        out.push('</tr>')
      }
      out.push('</tbody></table>')
      continue
    }

    const bq = line.match(/^>\s?(.*)$/)
    if (bq) {
      flushPara()
      closeLists()
      if (!inBq) {
        out.push('<blockquote>')
        inBq = true
      }
      out.push(`<p>${renderInline(bq[1])}</p>`)
      i++
      continue
    } else if (inBq && line.trim() === '') {
      closeBq()
      i++
      continue
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      flushPara()
      closeBq()
      if (inOl) { out.push('</ol>'); inOl = false }
      if (!inUl) { out.push('<ul>'); inUl = true }
      out.push(`<li>${renderInline(ul[1])}</li>`)
      i++
      continue
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/)
    if (ol) {
      flushPara()
      closeBq()
      if (inUl) { out.push('</ul>'); inUl = false }
      if (!inOl) { out.push('<ol>'); inOl = true }
      out.push(`<li>${renderInline(ol[1])}</li>`)
      i++
      continue
    }

    if (line.trim() === '') {
      flushPara()
      closeLists()
      closeBq()
      i++
      continue
    }

    closeLists()
    closeBq()
    paraBuf.push(line.trim())
    i++
  }

  closeAll()
  return out.join('\n')
}
