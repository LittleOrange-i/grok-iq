const RAW_HTML_START =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<(?:!doctype\s+html|html|head|body|main|div|section|article|aside|header|footer|nav|form|table|svg|canvas|style|script)\b/i

export function extractHtmlPreviews(content: string): string[] {
  const values = Array.from(
    content.matchAll(/```(?:html|htm|svg)\s*\r?\n([\s\S]*?)```/gi)
  )
    .map((match) => match[1].trim())
    .filter(Boolean)
  if (values.length) return values

  if (/<!doctype html|<html[\s>]/i.test(content)) {
    const start = content.search(/<!doctype html|<html[\s>]/i)
    const end = content.toLowerCase().lastIndexOf('</html>')
    return [content.slice(start, end >= 0 ? end + 7 : undefined).trim()]
  }

  const svgValues = Array.from(content.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)).map(
    (match) => match[0].trim()
  )
  if (svgValues.length) return svgValues

  const trimmed = content.trim()
  return RAW_HTML_START.test(trimmed) ? [trimmed] : []
}

export function buildHtmlDocument(html: string) {
  // The task response is evidence: altering it before preview makes the rendered
  // result differ from the stored upstream output. Isolation belongs to the
  // sandboxed iframe, while the HTML/CSS/JS source remains intact.
  const source = html.trim()
  const embeddableSource = source.replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
  return /<!doctype html|<html[\s>]/i.test(source)
    ? source
    : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${embeddableSource}</body></html>`
}
