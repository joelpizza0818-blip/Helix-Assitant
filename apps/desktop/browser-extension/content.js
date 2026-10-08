const MAX_TEXT_LENGTH = 80_000
let refreshTimer = null
let lastPublishedAt = 0

function visiblePageSnapshot() {
  const visibleText = document.body?.innerText ?? ''
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter((link) => link.getClientRects().length > 0)
    .slice(0, 120)
    .map((link) => ({
      text: (link.innerText || link.getAttribute('aria-label') || '').trim().slice(0, 300),
      url: link.href,
    }))
    .filter((link) => link.url.startsWith('http://') || link.url.startsWith('https://'))
  const forms = Array.from(document.querySelectorAll('input, textarea, select, button'))
    .filter((field) => field.getClientRects().length > 0)
    .slice(0, 80)
    .map((field) => ({
      label: (
        field.labels?.[0]?.innerText
        || field.getAttribute('aria-label')
        || field.getAttribute('placeholder')
        || field.innerText
        || field.getAttribute('name')
        || ''
      ).trim().slice(0, 300),
      type: (field.getAttribute('type') || field.tagName.toLowerCase()).slice(0, 40),
    }))

  return {
    title: document.title.slice(0, 500),
    url: location.href.slice(0, 4096),
    text: visibleText.slice(0, MAX_TEXT_LENGTH),
    links,
    forms,
    captured_at: new Date().toISOString(),
  }
}

function publishSnapshot(force = false) {
  const now = Date.now()
  if (!force && now - lastPublishedAt < 1500) return
  lastPublishedAt = now
  chrome.runtime.sendMessage({
    type: 'HELIX_PAGE_SNAPSHOT',
    snapshot: visiblePageSnapshot(),
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'HELIX_REFRESH_PAGE') return
  const snapshot = visiblePageSnapshot()
  sendResponse(snapshot)
})

const observer = new MutationObserver(() => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => publishSnapshot(), 900)
})

if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  publishSnapshot(true)
}

document.addEventListener('input', () => publishSnapshot())
document.addEventListener('change', () => publishSnapshot())
