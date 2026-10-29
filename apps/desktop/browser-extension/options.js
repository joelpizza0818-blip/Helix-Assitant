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
  status.textContent = 'Paired. HELIX only reads and controls browser tabs it opens for its own tasks.'
  status.style.color = '#a0ca92'
  await chrome.runtime.sendMessage({ type: 'HELIX_POLL_BROWSER_COMMANDS' })
})
