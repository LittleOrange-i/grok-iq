export async function copyText(value: string): Promise<void> {
  if (!value) throw new Error('没有可复制的内容')

  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard?.writeText &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Continue with the document.execCommand fallback below.
    }
  }

  if (copyTextWithSelection(value)) return
  throw new Error('复制失败，请检查浏览器剪贴板权限')
}

function copyTextWithSelection(value: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false

  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement
  textarea.value = value
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto 0'
  textarea.style.width = '1px'
  textarea.style.height = '1px'
  textarea.style.padding = '0'
  textarea.style.border = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  let copied: boolean
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
    if (activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true })
    }
  }
  return copied
}
