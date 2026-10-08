const HELIX_PORT = 47831
const HELIX_URL = `http://127.0.0.1:${HELIX_PORT}/page`
const PAGE_REFRESH_ALARM = 'helix-active-page-refresh'
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
  if (alarm.name !== PAGE_REFRESH_ALARM) return
  void (async () => {
    if (queuedActiveSnapshot) await publishSnapshot(queuedActiveSnapshot)
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (typeof tab?.id === 'number') await requestActiveTabSnapshot(tab.id)
  })()
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PAGE_REFRESH_ALARM, { periodInMinutes: 1 })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PAGE_REFRESH_ALARM, { periodInMinutes: 1 })
  void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (typeof tab?.id === 'number') void requestActiveTabSnapshot(tab.id)
  })
})
