importScripts('site-matching.js')
importScripts('browser-debugger.js')
importScripts('page-context-queue.js')

const HELIX_PORT = 47831
const HELIX_URL = `http://127.0.0.1:${HELIX_PORT}/page`
const COMMAND_POLL_ALARM = 'helix-browser-command-poll'
const PAGE_CONTEXT_REQUEST_TIMEOUT_MS = 10000
let pollingCommands = false
let pollAgain = false
let clearingPublishedSnapshot = null
let pageClearPending = false
const pageContextQueue = helixPageContextQueue.createPageContextQueue()
const MANAGED_TABS_KEY = 'helixManagedBrowserTabs'
const PENDING_PAGE_CLEAR_KEY = 'helixPendingPageClear'

async function readPairingToken() {
  const { pairingToken } = await chrome.storage.local.get('pairingToken')
  return typeof pairingToken === 'string' ? pairingToken.trim() : ''
}

async function fetchPageContext(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PAGE_CONTEXT_REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function performPageClear() {
  try {
    await chrome.storage.local.set({ [PENDING_PAGE_CLEAR_KEY]: true })
    const token = await readPairingToken()
    if (!token) return false
    const response = await fetchPageContext(`http://127.0.0.1:${HELIX_PORT}/page/clear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      console.warn(`[HELIX] Could not clear the previous browser page snapshot (${response.status}).`)
      return false
    }
    await chrome.storage.local.remove(PENDING_PAGE_CLEAR_KEY)
    pageClearPending = false
    return true
  } catch (error) {
    console.warn(
      `[HELIX] Could not clear the previous browser page snapshot: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

function clearPublishedSnapshot() {
  pageClearPending = true
  const operation = pageContextQueue.enqueue(performPageClear)
  clearingPublishedSnapshot = operation
  void operation.finally(() => {
    if (clearingPublishedSnapshot === operation) clearingPublishedSnapshot = null
  })
  return operation
}

async function clearPendingSnapshot() {
  const { [PENDING_PAGE_CLEAR_KEY]: pending } = await chrome.storage.local.get(PENDING_PAGE_CLEAR_KEY)
  if (!pageClearPending && !pending) return true
  if (clearingPublishedSnapshot) return clearingPublishedSnapshot
  return clearPublishedSnapshot()
}

/*
 * Page updates and clears must be serialized: otherwise a delayed snapshot
 * request can arrive after a later clear and restore content from an old tab.
 */
async function enqueuePageSnapshot(snapshot, tabId) {
  return pageContextQueue.enqueue(async () => {
    try {
      const { [PENDING_PAGE_CLEAR_KEY]: pending } = await chrome.storage.local.get(PENDING_PAGE_CLEAR_KEY)
      if (pageClearPending || pending) {
        if (!await performPageClear()) return false
      }
      if (!await isSelectedManagedTab(tabId)) return false
      const tab = await chrome.tabs.get(tabId)
      if (typeof snapshot?.url !== 'string' || snapshot.url !== tab.url) return false
      const token = await readPairingToken()
      if (!token) return false
      const response = await fetchPageContext(HELIX_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(snapshot),
      })
      if (!response.ok) {
        console.warn(`[HELIX] Page snapshot was rejected (${response.status}).`)
        return false
      }
      return true
    } catch (error) {
      console.warn(
        `[HELIX] Could not publish the active page snapshot: ${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
  })
}

async function getManagedTabs() {
  const { [MANAGED_TABS_KEY]: tabIds } = await chrome.storage.local.get(MANAGED_TABS_KEY)
  if (!Array.isArray(tabIds)) return []
  const validIds = tabIds.filter((tabId) => Number.isSafeInteger(tabId) && tabId >= 0)
  if (validIds.length > 1) {
    await chrome.storage.local.remove(MANAGED_TABS_KEY)
    await clearPublishedSnapshot()
    return []
  }
  return validIds
}

async function isManagedTab(tabId) {
  return (await getManagedTabs()).includes(tabId)
}

async function isSelectedManagedTab(tabId) {
  if (!await isManagedTab(tabId)) return false
  const [selectedTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  if (selectedTab?.id !== tabId) return false
  const focusedWindow = await chrome.windows.getLastFocused()
  return focusedWindow.focused && focusedWindow.id === selectedTab.windowId
}

async function registerManagedTab(tabId) {
  const tabIds = await getManagedTabs()
  await chrome.storage.local.set({
    [MANAGED_TABS_KEY]: [tabId],
  })
  const previousTabId = tabIds[0]
  if (previousTabId !== undefined && previousTabId !== tabId) {
    await clearPublishedSnapshot()
    try {
      await chrome.tabs.sendMessage(previousTabId, {
        type: 'HELIX_BROWSER_CONTROL',
        action: 'set_controlled',
        active: false,
      })
    } catch {
      // The previous page may have closed or navigated to a restricted URL.
    }
  }
}

async function unregisterManagedTab(tabId) {
  const tabIds = await getManagedTabs()
  if (!tabIds.includes(tabId)) return
  await chrome.storage.local.set({
    [MANAGED_TABS_KEY]: tabIds.filter((value) => value !== tabId),
  })
  await clearPublishedSnapshot()
}

async function findMatchingSiteTab(targetUrl, siteKey) {
  const tabs = await chrome.tabs.query({})
  return helixSiteMatching.findMatchingTab(tabs, targetUrl, siteKey || targetUrl)
}

async function activateManagedTab(tab, targetUrl) {
  if (!helixSiteMatching.hasSameOrigin(tab.url, targetUrl)) {
    const loading = waitForTabComplete(tab.id)
    await chrome.tabs.update(tab.id, { url: targetUrl, active: true })
    return loading
  }

  await chrome.tabs.update(tab.id, { active: true })
  return tab.status === 'complete'
    ? chrome.tabs.get(tab.id)
    : waitForTabComplete(tab.id, true)
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

async function prepareControlTarget(tabId, selector, purpose, text) {
  const result = await chrome.tabs.sendMessage(tabId, {
    type: 'HELIX_BROWSER_CONTROL',
    action: 'prepare_control',
    selector,
    purpose,
    text,
  })
  if (!result || result.ok !== true) {
    throw new Error(result?.error || 'The requested page control could not be located.')
  }
  return result
}

async function waitForStablePage(tabId) {
  try {
    const snapshot = await chrome.tabs.sendMessage(tabId, {
      type: 'HELIX_WAIT_FOR_STABLE_PAGE',
    })
    if (snapshot) await publishSnapshot(snapshot, tabId)
  } catch (error) {
    throw new Error(
      `The page action completed, but its result could not be verified: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function showControlCursor(tabId, x, y, clicked = false) {
  await chrome.tabs.sendMessage(tabId, {
    type: 'HELIX_BROWSER_CONTROL',
    action: 'show_cursor_at',
    x,
    y,
    clicked,
  })
}

async function publishSnapshot(snapshot, tabId) {
  await enqueuePageSnapshot(snapshot, tabId)
}

async function requestManagedTabSnapshot(tabId) {
  try {
    if (!await isSelectedManagedTab(tabId) || !await clearPendingSnapshot()) return
    await chrome.tabs.sendMessage(tabId, {
      type: 'HELIX_BROWSER_CONTROL',
      action: 'set_controlled',
      active: true,
    })
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: 'HELIX_REFRESH_PAGE' })
    if (snapshot) await publishSnapshot(snapshot, tabId)
  } catch (error) {
    console.warn(
      `[HELIX] Could not inspect the selected browser page: ${error instanceof Error ? error.message : String(error)}`,
    )
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
          const targetUrl = command.request.url || 'about:blank'
          let managedTab = await findMatchingSiteTab(targetUrl, command.request.site_key)
          if (managedTab) {
            managedTab = await activateManagedTab(managedTab, targetUrl)
            await registerManagedTab(managedTab.id)
          } else {
            const existingIds = await getManagedTabs()
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
                url: targetUrl,
                active: true,
              })
              managedTab = await loading
            } else {
              managedTab = await chrome.tabs.create({
                url: targetUrl,
                active: true,
              })
              if (typeof managedTab.id !== 'number') throw new Error('Could not create the HELIX browser tab.')
              await registerManagedTab(managedTab.id)
              managedTab = await waitForTabComplete(managedTab.id, true)
            }
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
        } else if (command.request.action === 'snapshot') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isSelectedManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          const tab = await chrome.tabs.get(tabId)
          if (!tab.active) {
            throw new Error('The selected HELIX tab is inactive; its page content was not read. Activate it and verify any previous action before retrying.')
          }
          const snapshot = await chrome.tabs.sendMessage(tabId, {
            type: 'HELIX_REFRESH_PAGE',
          })
          if (!snapshot || typeof snapshot !== 'object') {
            throw new Error('The managed page did not return a browser snapshot.')
          }
          result = { ok: true, result: snapshot }
        } else if (command.request.action === 'click') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          await chrome.tabs.update(tabId, { active: true })
          const target = await prepareControlTarget(
            tabId,
            command.request.selector,
            'click',
          )
          await showControlCursor(tabId, target.position.x, target.position.y)
          await helixBrowserDebugger.runAction(
            chrome.debugger,
            tabId,
            'click',
            target.position,
          )
          result = { ok: true, result: { clicked: true } }
        } else if (command.request.action === 'type') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          await chrome.tabs.update(tabId, { active: true })
          const target = await prepareControlTarget(
            tabId,
            command.request.selector,
            'type',
            command.request.text,
          )
          if (target.kind === 'select') {
            await showControlCursor(tabId, target.position.x, target.position.y)
            await helixBrowserDebugger.runAction(
              chrome.debugger,
              tabId,
              'select',
              { ...target.position, optionIndex: target.optionIndex },
            )
            const verification = await chrome.tabs.sendMessage(tabId, {
              type: 'HELIX_BROWSER_CONTROL',
              action: 'verify_select_value',
              selector: command.request.selector,
            })
            if (!verification?.ok || verification.value !== target.value) {
              throw new Error('The dropdown did not confirm the requested option. Verify its current value before retrying.')
            }
          } else {
            await showControlCursor(tabId, target.position.x, target.position.y)
            await helixBrowserDebugger.runAction(
              chrome.debugger,
              tabId,
              'click',
              target.position,
            )
            const { os } = await chrome.runtime.getPlatformInfo()
            await helixBrowserDebugger.runAction(
              chrome.debugger,
              tabId,
              'type',
              {
                text: command.request.text,
                selectAllKey: os === 'mac' ? 'Meta' : 'Control',
              },
            )
            const verification = await chrome.tabs.sendMessage(tabId, {
              type: 'HELIX_BROWSER_CONTROL',
              action: 'verify_type',
              selector: command.request.selector,
              text: command.request.text,
            })
            if (!verification?.ok) {
              throw new Error(verification?.error || 'The selected field did not confirm the requested text.')
            }
          }
          if (command.request.submit === true) {
            await helixBrowserDebugger.runAction(
              chrome.debugger,
              tabId,
              'press_key',
              { key: 'Enter' },
            )
          }
          result = { ok: true, result: { typed: true } }
        } else if ([
          'move_mouse', 'click_at', 'double_click_at', 'drag', 'scroll',
          'scroll_at', 'press_key',
        ].includes(command.request.action)) {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isManagedTab(tabId)) {
            throw new Error('This tab is not managed by HELIX.')
          }
          let action = command.request.action
          let input = { ...command.request }
          if (action === 'double_click_at') action = 'double_click'
          const viewport = await chrome.tabs.sendMessage(tabId, {
            type: 'HELIX_GET_VIEWPORT',
          })
          if (action === 'scroll' || action === 'scroll_at') {
            const x = action === 'scroll_at'
              ? command.request.x
              : Math.floor(viewport.width / 2)
            const y = action === 'scroll_at'
              ? command.request.y
              : Math.floor(viewport.height / 2)
            const amount = Math.abs(command.request.amount || 600)
            input = {
              x,
              y,
              deltaX: command.request.direction === 'right'
                ? amount
                : command.request.direction === 'left' ? -amount : 0,
              deltaY: command.request.direction === 'down'
                ? amount
                : command.request.direction === 'up' ? -amount : 0,
            }
            action = 'scroll'
          }
          const points = action === 'drag'
            ? [[input.x, input.y], [input.end_x, input.end_y]]
            : action === 'move_mouse' || action === 'click_at' || action === 'double_click'
              ? [[input.x, input.y]]
              : action === 'scroll'
                ? [[input.x, input.y]]
                : []
          if (points.some(([x, y]) =>
            !Number.isInteger(x) || !Number.isInteger(y)
            || x < 0 || y < 0
            || x >= viewport.width || y >= viewport.height
          )) {
            throw new Error('The requested point is outside the browser page viewport.')
          }
          if (action === 'move_mouse' || action === 'click_at') {
            input.button = command.request.button || 'left'
          }
          if (action === 'double_click') input.button = command.request.button || 'left'
          if (action === 'drag') input.button = command.request.button || 'left'
          await chrome.tabs.update(tabId, { active: true })
          if (action !== 'press_key') {
            await showControlCursor(tabId, input.x, input.y)
          }
          await helixBrowserDebugger.runAction(
            chrome.debugger,
            tabId,
            action,
            input,
          )
          result = { ok: true, result: { completed: true } }
        } else if (command.request.action === 'screenshot') {
          const tabId = Number(command.request.session_id)
          if (!Number.isSafeInteger(tabId) || !await isSelectedManagedTab(tabId)) {
            throw new Error('The selected HELIX tab is inactive; its page content was not read.')
          }
          const screenshot = await helixBrowserDebugger.runAction(
            chrome.debugger,
            tabId,
            'screenshot',
          )
          result = { ok: true, result: screenshot }
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
          throw new Error(`Unsupported browser command: ${command.request.action}`)
        }
        if (
          result.ok === true
          && !['open_session', 'navigate', 'go_back', 'refresh', 'close', 'screenshot'].includes(command.request.action)
        ) {
          await waitForStablePage(Number(command.request.session_id))
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
    if (body.commands?.length > 0) pollAgain = true
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

async function refreshForegroundPageContext() {
  const [selectedTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  if (typeof selectedTab?.id === 'number' && await isSelectedManagedTab(selectedTab.id)) {
    await requestManagedTabSnapshot(selectedTab.id)
  } else {
    await clearPublishedSnapshot()
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'HELIX_PAGE_SNAPSHOT' || typeof sender.tab?.id !== 'number') return
  void (async () => {
    try {
      if (!await isSelectedManagedTab(sender.tab.id) || !await clearPendingSnapshot()) return
      await publishSnapshot(message.snapshot, sender.tab.id)
      await pollCommands()
    } catch (error) {
      console.warn(
        `[HELIX] Could not process a selected-page update: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })()
})

chrome.tabs.onActivated.addListener(() => {
  void refreshForegroundPageContext().catch((error) => {
    console.warn(
      `[HELIX] Could not refresh the active browser page: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  const refresh = windowId === chrome.windows.WINDOW_ID_NONE
    ? clearPublishedSnapshot()
    : refreshForegroundPageContext()
  void refresh.catch((error) => {
    console.warn(
      `[HELIX] Could not refresh the focused browser window: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'loading' || typeof changeInfo.url === 'string')) {
    void (async () => {
      if (await isManagedTab(tabId)) await clearPublishedSnapshot()
    })().catch((error) => {
      console.warn(
        `[HELIX] Could not clear the previous browser page during navigation: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }
  if (changeInfo.status === 'complete' && tab.active) {
    void refreshForegroundPageContext().catch((error) => {
      console.warn(
        `[HELIX] Could not refresh the active browser page: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    void pollCommands()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void unregisterManagedTab(tabId).catch((error) => {
    console.warn(
      `[HELIX] Could not clear the closed browser tab: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== COMMAND_POLL_ALARM) return
  void refreshForegroundPageContext().catch((error) => {
    console.warn(
      `[HELIX] Could not refresh the active browser snapshot: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
  void pollCommands()
})

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
})

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.remove(MANAGED_TABS_KEY)
  await clearPublishedSnapshot()
  chrome.alarms.create(COMMAND_POLL_ALARM, { periodInMinutes: 0.5 })
  void pollCommands()
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'HELIX_POLL_BROWSER_COMMANDS') void pollCommands()
})
