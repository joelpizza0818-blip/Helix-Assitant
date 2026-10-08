const tokenInput = document.getElementById('pairing-token')
const status = document.getElementById('status')

chrome.storage.local.get('pairingToken').then(({ pairingToken }) => {
  if (typeof pairingToken === 'string') tokenInput.value = pairingToken
})

document.getElementById('save-token').addEventListener('click', async () => {
  const pairingToken = tokenInput.value.trim()
  if (!/^[a-f0-9]{64}$/.test(pairingToken)) {
    status.textContent = 'Enter the 64-character token from HELIX Toolbox.'
    status.style.color = '#d4544a'
    return
  }
  await chrome.storage.local.set({ pairingToken })
  status.textContent = 'Paired. HELIX will receive the active tab when you switch pages.'
  status.style.color = '#a0ca92'
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (typeof tab?.id === 'number') {
    try {
      const snapshot = await chrome.tabs.sendMessage(tab.id, { type: 'HELIX_REFRESH_PAGE' })
      if (snapshot) {
        await chrome.runtime.sendMessage({ type: 'HELIX_PAGE_SNAPSHOT', snapshot })
      }
    } catch {
      status.textContent += ' Refresh a supported web page to connect.'
    }
  }
})
