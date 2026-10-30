const tokenInput = document.getElementById('pairing-token')
const status = document.getElementById('status')
const HELIX_HEARTBEAT_URL = 'http://127.0.0.1:47831/heartbeat'

async function testConnection(pairingToken) {
  if (!/^[a-f0-9]{64}$/.test(pairingToken)) {
    status.textContent = 'Enter and save the 64-character token currently shown in HELIX Toolbox.'
    status.style.color = '#d4544a'
    return false
  }

  status.textContent = 'Checking the HELIX Desktop bridge…'
  status.style.color = '#b8b3b0'
  try {
    const response = await fetch(HELIX_HEARTBEAT_URL, {
      headers: { Authorization: `Bearer ${pairingToken}` },
    })
    if (response.status === 401) {
      status.textContent = 'Token rejected. Copy the current token from HELIX Toolbox, save it here, then test again.'
      status.style.color = '#d4544a'
      return false
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      const detail = body && typeof body.error === 'string'
        ? ` ${body.error}`
        : ''
      const origin = response.status === 403
        ? ` Extension origin: chrome-extension://${chrome.runtime.id}.`
        : ''
      status.textContent = `HELIX bridge returned HTTP ${response.status}.${detail}${origin} Check that this extension is installed in Chrome or Edge and reload it before testing again.`
      status.style.color = '#d4544a'
      return false
    }
    status.textContent = 'Connected to HELIX Desktop. Browser Companion is ready.'
    status.style.color = '#a0ca92'
    void chrome.runtime.sendMessage({ type: 'HELIX_POLL_BROWSER_COMMANDS' }).catch(() => {})
    return true
  } catch {
    status.textContent = 'Could not reach HELIX Desktop. Open or restart HELIX, then test the connection again.'
    status.style.color = '#d4544a'
    return false
  }
}

chrome.storage.local.get('pairingToken').then(({ pairingToken }) => {
  if (typeof pairingToken === 'string') tokenInput.value = pairingToken
})

document.getElementById('save-token').addEventListener('click', async () => {
  const pairingToken = tokenInput.value.trim()
  if (!/^[a-f0-9]{64}$/.test(pairingToken)) {
    status.textContent = 'Enter the 64-character token currently shown in HELIX Toolbox.'
    status.style.color = '#d4544a'
    return
  }
  await chrome.storage.local.set({ pairingToken })
  await testConnection(pairingToken)
})

document.getElementById('test-connection').addEventListener('click', async () => {
  const { pairingToken } = await chrome.storage.local.get('pairingToken')
  await testConnection(typeof pairingToken === 'string' ? pairingToken.trim() : '')
})
