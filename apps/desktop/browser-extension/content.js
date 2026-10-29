const MAX_TEXT_LENGTH = 80_000
let refreshTimer = null
let lastPublishedAt = 0
let helixOverlay = null
let helixCursor = null
let helixPulse = null

function setHelixControlOverlay(active) {
  if (!active) {
    helixOverlay?.remove()
    helixOverlay = null
    helixCursor = null
    helixPulse = null
    return
  }
  if (helixOverlay?.isConnected) return

  helixOverlay = document.createElement('div')
  helixOverlay.id = 'helix-controlled-tab-indicator'
  helixOverlay.setAttribute('aria-hidden', 'true')
  helixOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const shadow = helixOverlay.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .frame { position:fixed; inset:0; border:3px solid #ee6018;
        box-shadow:inset 0 0 16px rgba(238,96,24,.9), 0 0 14px rgba(238,96,24,.8); }
      .cursor { position:fixed; width:24px; height:32px; opacity:0;
        transform:translate3d(-100px,-100px,0); transition:transform 20ms linear; }
      .cursor svg { width:100%; height:100%; filter:drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
      .pulse { position:fixed; width:28px; height:28px; margin:-14px 0 0 -14px;
        border:2px solid #ee6018; border-radius:50%; opacity:0; transform:scale(.35); }
      .pulse.active { animation:helix-click 420ms ease-out; }
      @keyframes helix-click {
        0% { opacity:.9; transform:scale(.35); }
        100% { opacity:0; transform:scale(1.7); }
      }
    </style>
    <div class="frame"></div>
    <div class="cursor"><svg viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 2v25l6.4-6.1 4.1 9.2 4.1-1.8-4.1-9.1H23L3 2Z"
        fill="#ee6018" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    </svg></div>
    <div class="pulse"></div>`
  helixCursor = shadow.querySelector('.cursor')
  helixPulse = shadow.querySelector('.pulse')
  document.documentElement.appendChild(helixOverlay)
}

function showHelixCursor(element, clicked = false) {
  const box = element?.getBoundingClientRect()
  if (!box || !helixOverlay?.isConnected) return
  if (!helixCursor || !helixPulse) return
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  helixCursor.style.opacity = '1'
  helixCursor.style.transform = `translate3d(${x}px,${y}px,0)`
  if (clicked) {
    helixPulse.style.left = `${x}px`
    helixPulse.style.top = `${y}px`
    helixPulse.classList.remove('active')
    void helixPulse.offsetWidth
    helixPulse.classList.add('active')
  }
}

function showHelixCursorAt(x, y, clicked = false) {
  if (!helixOverlay?.isConnected || !helixCursor || !helixPulse) return
  helixCursor.style.opacity = '1'
  helixCursor.style.transform = `translate3d(${x}px,${y}px,0)`
  if (clicked) {
    helixPulse.style.left = `${x}px`
    helixPulse.style.top = `${y}px`
    helixPulse.classList.remove('active')
    void helixPulse.offsetWidth
    helixPulse.classList.add('active')
  }
}

function dispatchMouseAt(element, type, x, y, button = 'left') {
  const buttonCode = { left: 0, middle: 1, right: 2 }[button] ?? 0
  element.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: buttonCode,
    buttons: type === 'mousedown' ? 1 << buttonCode : 0,
  }))
}

function findScrollableElement(target, deltaX, deltaY) {
  let element = target instanceof HTMLElement ? target : target?.parentElement
  while (element instanceof HTMLElement) {
    const style = getComputedStyle(element)
    if (
      deltaY !== 0
      && ['auto', 'scroll'].includes(style.overflowY)
      && element.scrollHeight > element.clientHeight
    ) return element
    if (
      deltaX !== 0
      && ['auto', 'scroll'].includes(style.overflowX)
      && element.scrollWidth > element.clientWidth
    ) return element
    element = element.parentElement
  }
  return null
}

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
  const controls = helixOverlay?.isConnected
    ? Array.from(document.querySelectorAll('a[href], button, input, textarea, select, [role="button"]'))
      .filter((element) => element.getClientRects().length > 0)
      .slice(0, 100)
      .map((element, index) => {
        element.setAttribute('data-helix-control', String(index))
        return {
          label: (
            element.getAttribute('aria-label')
            || element.innerText
            || element.getAttribute('placeholder')
            || element.getAttribute('title')
            || element.getAttribute('name')
            || ''
          ).trim().slice(0, 300),
          tag: element.tagName.toLowerCase(),
          selector: `[data-helix-control="${index}"]`,
        }
      })
    : []

  return {
    title: document.title.slice(0, 500),
    url: location.href.slice(0, 4096),
    text: visibleText.slice(0, MAX_TEXT_LENGTH),
    links,
    forms,
    controls,
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
  if (message?.type === 'HELIX_BROWSER_CONTROL') {
    try {
      if (message.action === 'set_controlled') {
        setHelixControlOverlay(message.active === true)
        sendResponse({ ok: true })
        return true
      }
      const element = message.selector ? document.querySelector(message.selector) : null
      if (message.action === 'click' && element instanceof HTMLElement) {
        showHelixCursor(element, true)
        element.click()
      } else if (message.action === 'move_mouse') {
        const target = document.elementFromPoint(message.x, message.y)
        showHelixCursorAt(message.x, message.y)
        target?.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          view: window,
          clientX: message.x,
          clientY: message.y,
        }))
      } else if (message.action === 'click_at' || message.action === 'double_click_at') {
        const target = document.elementFromPoint(message.x, message.y)
        if (!target) throw new Error('No page element exists at those coordinates.')
        const button = message.button || 'left'
        showHelixCursorAt(message.x, message.y, true)
        dispatchMouseAt(target, 'mousedown', message.x, message.y, button)
        dispatchMouseAt(target, 'mouseup', message.x, message.y, button)
        dispatchMouseAt(target, button === 'right' ? 'contextmenu' : button === 'middle' ? 'auxclick' : 'click', message.x, message.y, button)
        if (message.action === 'double_click_at' && button === 'left') {
          dispatchMouseAt(target, 'mousedown', message.x, message.y)
          dispatchMouseAt(target, 'mouseup', message.x, message.y)
          dispatchMouseAt(target, 'click', message.x, message.y)
          dispatchMouseAt(target, 'dblclick', message.x, message.y)
        }
      } else if (message.action === 'type' && (
        element instanceof HTMLInputElement
        || element instanceof HTMLTextAreaElement
        || element instanceof HTMLSelectElement
      )) {
        element.focus()
        const value = String(message.text ?? '')
        if (element instanceof HTMLSelectElement) {
          const option = Array.from(element.options).find(
            (item) => item.value === value || item.label === value,
          )
          if (!option) throw new Error('No matching option was found for this select control.')
          element.value = option.value
        } else {
          const prototype = element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype
          Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
        }
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        showHelixCursor(element)
        if (message.submit === true) element.form?.requestSubmit()
      } else if (message.action === 'scroll') {
        const amount = Math.abs(message.amount || 600)
        const deltaX = message.direction === 'right' ? amount : message.direction === 'left' ? -amount : 0
        const deltaY = message.direction === 'up' ? -amount : message.direction === 'down' ? amount : 0
        window.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' })
      } else if (message.action === 'scroll_at') {
        const target = document.elementFromPoint(message.x, message.y)
        const amount = Math.abs(message.amount || 600)
        const deltaX = message.direction === 'right' ? amount : message.direction === 'left' ? -amount : 0
        const deltaY = message.direction === 'up' ? -amount : message.direction === 'down' ? amount : 0
        const scrollable = findScrollableElement(target, deltaX, deltaY)
        if (scrollable) scrollable.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' })
        else window.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' })
      } else if (message.action === 'press_key') {
        const target = document.activeElement || document.body
        target?.dispatchEvent(new KeyboardEvent('keydown', {
          key: message.key,
          bubbles: true,
          cancelable: true,
        }))
        target?.dispatchEvent(new KeyboardEvent('keyup', {
          key: message.key,
          bubbles: true,
          cancelable: true,
        }))
      } else if (message.action === 'snapshot') {
        sendResponse(visiblePageSnapshot())
        return true
      }
      sendResponse({ ok: true })
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
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
