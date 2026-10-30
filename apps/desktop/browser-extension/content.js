const MAX_TEXT_LENGTH = 80_000
let refreshTimer = null
let lastPublishedAt = 0
let helixOverlay = null
let helixCursor = null
let helixPulse = null
let nextControlId = 0
const controlDocumentId = Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (value) => value.toString(16).padStart(2, '0'),
).join('')
const controlIdsByElement = new WeakMap()
const controlElementsById = new Map()

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

function isVisibleControl(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (
    rect.right <= 0 || rect.bottom <= 0
    || rect.left >= window.innerWidth || rect.top >= window.innerHeight
  ) return false

  let current = element
  while (current instanceof HTMLElement) {
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    current = current.parentElement
  }
  return true
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
  const formControls = Array.from(document.querySelectorAll(
    'input, textarea, select, button, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]',
  ))
    .filter(isVisibleControl)
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
      role: field.getAttribute('role') || '',
      placeholder: (field.getAttribute('placeholder') || '').slice(0, 300),
      required: field.required === true || field.getAttribute('aria-required') === 'true',
      disabled: field.disabled === true || field.getAttribute('aria-disabled') === 'true',
    }))
  const controls = Array.from(document.querySelectorAll(
    'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="searchbox"], [contenteditable="true"]',
  ))
    .filter(isVisibleControl)
    .slice(0, 180)
    .map((element, index) => {
      let controlId = controlIdsByElement.get(element)
      if (!controlId) {
        controlId = `helix-${controlDocumentId}-${++nextControlId}`
        controlIdsByElement.set(element, controlId)
      }
      element.setAttribute('data-helix-control', controlId)
      controlElementsById.set(controlId, element)
      return {
        index: index + 1,
        label: (
          element.getAttribute('aria-label')
          || element.innerText
          || element.getAttribute('placeholder')
          || element.getAttribute('title')
          || element.getAttribute('name')
          || ''
        ).trim().slice(0, 300),
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        type: (element.getAttribute('type') || '').slice(0, 40),
        selector: `[data-helix-control="${controlId}"]`,
        enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true',
      }
    })
  for (const [controlId, element] of controlElementsById) {
    if (!element.isConnected) controlElementsById.delete(controlId)
  }

  return {
    title: document.title.slice(0, 500),
    url: location.href.slice(0, 4096),
    text: visibleText.slice(0, MAX_TEXT_LENGTH),
    links,
    forms: formControls,
    controls,
    captured_at: new Date().toISOString(),
  }
}

function findControlElement(selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw new Error('A CSS selector or control label is required.')
  }
  const query = selector.trim()
  const generatedControl = query.match(/^\[data-helix-control="(helix-[a-f0-9]{32}-\d+)"\]$/)
  if (generatedControl) {
    const element = controlElementsById.get(generatedControl[1])
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      throw new Error('This page control reference is stale. Refresh page content and use its current selector.')
    }
    return element
  }
  if (query.startsWith('text=')) {
    const text = query.slice(5).replace(/^["']|["']$/g, '').trim().toLowerCase()
    if (!text) throw new Error('A visible text label is required after "text=".')
    const candidates = Array.from(document.querySelectorAll(
      'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="searchbox"], [role="checkbox"], [role="radio"], [role="menuitem"], [contenteditable="true"]',
    )).filter((candidate) => {
      if (!isVisibleControl(candidate)) return false
      const label = (
        candidate.getAttribute('aria-label')
        || candidate.getAttribute('placeholder')
        || candidate.innerText
        || candidate.textContent
        || ''
      ).trim().toLowerCase()
      return label === text || label.includes(text)
    })
    const exact = candidates.filter((candidate) => {
      const label = (
        candidate.getAttribute('aria-label')
        || candidate.getAttribute('placeholder')
        || candidate.innerText
        || candidate.textContent
        || ''
      ).trim().toLowerCase()
      return label === text
    })
    const matches = exact.length > 0 ? exact : candidates
    if (matches.length === 0) throw new Error(`No visible page control matches "${text}".`)
    if (matches.length > 1) {
      throw new Error(`The text "${text}" matches ${matches.length} controls; use a unique label or CSS selector.`)
    }
    return matches[0]
  }

  let element
  try {
    element = document.querySelector(query)
  } catch {
    throw new Error('The control selector is not valid CSS. Use text=Visible label for visible text.')
  }
  if (element) return element

  const visibleTextMatch = Array.from(document.querySelectorAll(
    'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="searchbox"], [role="checkbox"], [role="radio"], [role="menuitem"], [contenteditable="true"]',
  )).filter(isVisibleControl)
    .filter((candidate) => (
      candidate.getAttribute('aria-label')
      || candidate.getAttribute('placeholder')
      || candidate.innerText
      || candidate.textContent
      || ''
    ).trim().toLowerCase() === query.toLowerCase())
  if (visibleTextMatch.length === 1) return visibleTextMatch[0]
  if (visibleTextMatch.length > 1) {
    throw new Error(`The text "${query}" matches ${visibleTextMatch.length} controls; use a unique label or CSS selector.`)
  }
  throw new Error(`No page control matches "${query}". Refresh the page and inspect its controls again.`)
}

function findControl(selector, purpose) {
  const element = findControlElement(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error('The selected page element cannot receive browser input.')
  }
  if (
    element.getAttribute('aria-disabled') === 'true'
    || ('disabled' in element && element.disabled)
  ) {
    throw new Error('The requested page control is disabled.')
  }

  if (purpose === 'type') {
    if (element instanceof HTMLInputElement) {
      const inputType = (element.type || 'text').toLowerCase()
      if (['password', 'file', 'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType)) {
        throw new Error(`Typing into input type "${inputType}" is not supported.`)
      }
      if (element.readOnly) throw new Error('The selected input is read-only.')
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.readOnly) throw new Error('The selected text area is read-only.')
    } else if (
      !(element instanceof HTMLSelectElement)
      && !element.isContentEditable
      && !['textbox', 'searchbox', 'combobox'].includes(element.getAttribute('role') || '')
    ) {
      throw new Error('The selected control is not an editable text field.')
    }
  }

  const rect = element.getBoundingClientRect()
  if (!isVisibleControl(element)) {
    throw new Error('The requested page control is not visible.')
  }
  element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' })
  element.focus({ preventScroll: true })
  const updatedRect = element.getBoundingClientRect()
  const x = Math.max(0, Math.min(window.innerWidth - 1, updatedRect.left + updatedRect.width / 2))
  const y = Math.max(0, Math.min(window.innerHeight - 1, updatedRect.top + updatedRect.height / 2))
  const hitTarget = document.elementFromPoint(x, y)
  if (!hitTarget || (hitTarget !== element && !element.contains(hitTarget))) {
    throw new Error('Another page element covers the selected control; the action was not sent.')
  }
  showHelixCursor(element)
  return {
    element,
    position: { x, y },
  }
}

function getSelectOption(selector, value) {
  const { element } = findControl(selector, 'type')
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error('The selected control is not a dropdown.')
  }
  if (element.multiple) {
    throw new Error('Multi-select dropdowns are not supported.')
  }
  const options = Array.from(element.options).filter((option) => (
    !option.disabled && !option.parentElement?.hasAttribute('disabled')
  ))
  const optionIndex = options.findIndex(
    (item) => item.value === value || item.label === value || item.textContent?.trim() === value,
  )
  if (optionIndex < 0) throw new Error(`No enabled dropdown option matches "${value}".`)
  return { optionIndex, value: options[optionIndex].value }
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
      if (message.action === 'show_cursor_at') {
        showHelixCursorAt(message.x, message.y, message.clicked === true)
        sendResponse({ ok: true })
        return true
      }
      if (message.action === 'prepare_control') {
        const { element, position } = findControl(message.selector, message.purpose)
        const selection = element instanceof HTMLSelectElement
          ? getSelectOption(message.selector, String(message.text ?? ''))
          : null
        sendResponse({
          ok: true,
          position,
          kind: element instanceof HTMLSelectElement ? 'select' : 'text',
          ...(selection || {}),
        })
        return true
      }
      if (message.action === 'verify_select_value') {
        const { element } = findControl(message.selector, 'type')
        if (!(element instanceof HTMLSelectElement)) {
          throw new Error('The selected control is not a dropdown.')
        }
        sendResponse({ ok: true, value: element.value })
        return true
      }
      if (message.action === 'verify_type') {
        const { element } = findControl(message.selector, 'type')
        const actual = 'value' in element && typeof element.value === 'string'
          ? element.value
          : element.isContentEditable
            ? element.innerText
            : element.textContent ?? ''
        if (actual !== message.text) {
          throw new Error('The selected control did not retain the requested text.')
        }
        sendResponse({ ok: true })
        return true
      }
      if (message.action === 'snapshot') {
        sendResponse(visiblePageSnapshot())
        return true
      }
      throw new Error(`Unsupported page control action: ${message.action}`)
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (message?.type === 'HELIX_GET_VIEWPORT') {
    sendResponse({ width: window.innerWidth, height: window.innerHeight })
    return true
  }
  if (message?.type === 'HELIX_WAIT_FOR_STABLE_PAGE') {
    let stableTimer
    let timeoutTimer
    let observer
    const finish = () => {
      if (stableTimer) clearTimeout(stableTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      observer?.disconnect()
      sendResponse(visiblePageSnapshot())
    }
    const restartStableTimer = () => {
      if (stableTimer) clearTimeout(stableTimer)
      stableTimer = setTimeout(finish, 350)
    }
    if (document.body) {
      observer = new MutationObserver(restartStableTimer)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-expanded', 'aria-hidden', 'aria-selected', 'disabled', 'class', 'role'],
      })
    }
    restartStableTimer()
    timeoutTimer = setTimeout(finish, 2500)
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
