const HELIX_PORT = 47831
const HELIX_URL = `http://127.0.0.1:${HELIX_PORT}/page`
const COMMAND_POLL_ALARM = 'helix-browser-command-poll'
let queuedActiveSnapshot = null
let pollingCommands = false
let pollAgain = false
const MANAGED_TABS_KEY = 'helixManagedBrowserTabs'

async function readPairingToken() {
  const { pairingToken } = await chrome.storage.local.get('pairingToken')
  return typeof pairingToken === 'string' ? pairingToken.trim() : ''
}

async function getManagedTabs() {
  const { [MANAGED_TABS_KEY]: tabIds } = await chrome.storage.local.get(MANAGED_TABS_KEY)
  return Array.isArray(tabIds)
    ? tabIds.filter((tabId) => Number.isSafeInteger(tabId) && tabId >= 0)
    : []
}

async function isManagedTab(tabId) {
  return (await getManagedTabs()).includes(tabId)
}

async function registerManagedTab(tabId) {
  const tabIds = await getManagedTabs()
  await chrome.storage.local.set({
    [MANAGED_TABS_KEY]: Array.from(new Set([...tabIds, tabId])),
  })
}

async function unregisterManagedTab(tabId) {
  await chrome.storage.local.set({
    [MANAGED_TABS_KEY]: (await getManagedTabs()).filter((value) => value !== tabId),
  })
}

function waitForTabComplete(tabId, checkCurrent = false) {
  return new Promise((resolve, reject) => {
    let timeout = null
    let settled = false
    const finish = (error, tab) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(onUpdated)
      if (error) reject(error)
      else resolve(tab)
    }
    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(null, tab)
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    timeout = setTimeout(() => finish(new Error('Timed out waiting for the HELIX tab to finish loading.')), 30000)
    if (checkCurrent) {
      chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === 'complete') finish(null, tab)
      }).catch((error) => finish(error))
    }
  })
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

async function requestManagedTabSnapshot(tabId) {
  if (!await isManagedTab(tabId)) return
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'HELIX_BROWSER_CONTROL',
      action: 'set_controlled',
      active: true,
    })
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'HELIX_REFRESH_PAGE' })
    if (snapshot) await publishSnapshot(snapshot)
  } catch {
    // The managed tab may still be loading or may have navigated to a restricted page.
  }
}

async function pollCommands() {
  if (pollingCommands) {
    pollAgain = true
    return
  }
  pollingCommands = true
  try {
    const token = await readPairingToken()
    if (!token) return
    const response = await fetch(`http://127.0.0.1:${HELIX_PORT}/commands`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const body = await response.json()
    for (const command of body.commands || []) {
      let result = { ok: false, error: 'Unsupported browser command.' }
      try {
        if (command.request.action === 'open_session') {
          const existingIds = await getManagedTabs()
          let managedTab = null
          for (const tabId of existingIds) {
            try {
              managedTab = await chrome.tabs.get(tabId)
              break
            } catch {
              await unregisterManagedTab(tabId)
            }
          }
          if (managedTab) {
            const loading = waitForTabComplete(managedTab.id)
            await chrome.tabs.update(managedTab.id, {
              url: command.request.url || 'about:blank',
              active: true,
            })
            managedTab = await loading
          } else {
            managedTab = await chrome.tabs.create({
              url: command.request.url || 'about:blank',
              active: true,
            })
            if (typeof managedTab.id !== 'number') throw new Error('Could not create the HELIX browser tab.')
            await registerManagedTab(managedTab.id)
            managedTab = await waitForTabComplete(managedTab.id, true)
          }
          await requestManagedTabSnapshot(managedTab.id)
          result = { ok: true, result: { session_id: String(managedTab.id), url: managedTab.url } }
        } else if (command.request.action === 'navigate') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          const loading = waitForTabComplete(tabId)
          await chrome.tabs.update(tabId, { url: command.request.url, active: true })
          const loadedTab = await loading
          await requestManagedTabSnapshot(tabId)
          result = { ok: true, result: { session_id: String(loadedTab.id), url: loadedTab.url } }
        } else if (command.request.action === 'close') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          await chrome.tabs.remove(tabId)
          await unregisterManagedTab(tabId)
          result = { ok: true, result: { closed: true } }
        } else if (command.request.action === 'screenshot') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          const tab = await chrome.tabs.get(tabId)
          const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
          if (activeTab?.id !== tabId) {
            throw new Error('Activate the HELIX browser tab before requesting a screenshot.')
          }
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
            format: 'jpeg',
            quality: 65,
          })
          result = { ok: true, result: { data_url: dataUrl } }
        } else if (command.request.action === 'go_back' || command.request.action === 'refresh') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          const loading = waitForTabComplete(tabId)
          if (command.request.action === 'go_back') await chrome.tabs.goBack(tabId)
          else await chrome.tabs.reload(tabId)
          await loading
          await requestManagedTabSnapshot(tabId)
          result = { ok: true, result: { session_id: String(tabId) } }
        } else {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          const responseValue = await chrome.tabs.sendMessage(tabId, { type: 'HELIX_BROWSER_CONTROL', ...command.request })
          if (responseValue?.ok === false) throw new Error(responseValue.error || 'Browser action failed.')
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
  } finally {
    pollingCommands = false
    if (pollAgain) {
      pollAgain = false
      void pollCommands()
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'HELIX_PAGE_SNAPSHOT' || typeof sender.tab?.id !== 'number') return
  void (async () => {
    if (!await isManagedTab(sender.tab.id)) return
    queuedActiveSnapshot = message.snapshot
    await publishSnapshot(message.snapshot)
    await pollCommands()
  })()
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void requestManagedTabSnapshot(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    void requestManagedTabSnapshot(tabId)
    void pollCommands()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void unregisterManagedTab(tabId)
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
  void pollCommands()
  void getManagedTabs().then(async (tabIds) => {
    for (const tabId of tabIds) {
      try {
        await chrome.tabs.get(tabId)
        await requestManagedTabSnapshot(tabId)
      } catch {
        await unregisterManagedTab(tabId)
      }
    }
  })
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'HELIX_POLL_BROWSER_COMMANDS') void pollCommands()
})
