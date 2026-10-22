const HELIX_PORT = 47831
const HELIX_URL = `http://127.0.0.1:${HELIX_PORT}/page`
const PAGE_REFRESH_ALARM = 'helix-active-page-refresh'
const COMMAND_POLL_ALARM = 'helix-browser-command-poll'
let queuedActiveSnapshot = null

async function readPairingToken() {
  const { pairingToken } = await chrome.storage.local.get('pairingToken')
  return typeof pairingToken === 'string' ? pairingToken.trim() : ''
}

async function isActiveTab(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab?.id === tabId
}

async function publishSnapshot(snapshot) {
  const token = await readPairingToken()
  if (!token) return

  try {
    const response = await fetch(HELIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(snapshot),
    })
    if (response.ok) {
      queuedActiveSnapshot = null
      return
    }
    if (response.status === 503 || response.status >= 500) {
      queuedActiveSnapshot = snapshot
      return
    }
    console.warn(`[HELIX] Page snapshot was rejected (${response.status}). Check the pairing token in HELIX Toolbox.`)
  } catch {
    queuedActiveSnapshot = snapshot
  }
}

async function requestActiveTabSnapshot(tabId) {
  if (!await isActiveTab(tabId)) return
  try {
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'HELIX_REFRESH_PAGE' })
    if (snapshot) await publishSnapshot(snapshot)
  } catch {
    // Browser-internal and restricted pages do not allow content scripts.
  }
}

async function pollCommands() {
  const token = await readPairingToken()
  if (!token) return
  try {
    const response = await fetch(`http://127.0.0.1:${HELIX_PORT}/commands`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const body = await response.json()
    for (const command of body.commands || []) {
      let result = { ok: false, error: 'Unsupported browser command.' }
      try {
        if (command.request.action === 'open_session') {
          const tab = await chrome.tabs.create({ url: command.request.url || 'about:blank', active: false })
          result = { ok: true, result: { session_id: String(tab.id), url: tab.pendingUrl || tab.url } }
        } else if (command.request.action === 'navigate') {
          const tab = await chrome.tabs.update(Number(command.request.session_id), { url: command.request.url, active: false })
          result = { ok: true, result: { session_id: String(tab.id), url: tab.pendingUrl || tab.url } }
        } else if (command.request.action === 'close') {
          await chrome.tabs.remove(Number(command.request.session_id))
          result = { ok: true, result: { closed: true } }
        } else {
          const responseValue = await chrome.tabs.sendMessage(Number(command.request.session_id), { type: 'HELIX_BROWSER_CONTROL', ...command.request })
          result = responseValue || { ok: true }
        }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
      await fetch(`http://127.0.0.1:${HELIX_PORT}/commands/${command.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(result),
      })
    }
  } catch {
    // The desktop agent may be stopped; retry on the next alarm.
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'HELIX_PAGE_SNAPSHOT' || typeof sender.tab?.id !== 'number') return
  void (async () => {
    if (!await isActiveTab(sender.tab.id)) return
    queuedActiveSnapshot = message.snapshot
    await publishSnapshot(message.snapshot)
  })()
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void requestActiveTabSnapshot(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    void requestActiveTabSnapshot(tabId)
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COMMAND_POLL_ALARM) { void pollCommands(); return }
  if (alarm.name !== PAGE_REFRESH_ALARM) return
  void (async () => {
    if (queuedActiveSnapshot) await publishSnapshot(queuedActiveSnapshot)
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (typeof tab?.id === 'number') await requestActiveTabSnapshot(tab.id)
  })()
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PAGE_REFRESH_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PAGE_REFRESH_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
  void pollCommands()
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (typeof tab?.id === 'number') void requestActiveTabSnapshot(tab.id)
  })
})
