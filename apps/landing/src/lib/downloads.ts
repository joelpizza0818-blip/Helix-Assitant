const configuredInstallerUrl = import.meta.env.VITE_HELIX_WINDOWS_INSTALLER_URL?.trim()

// The release build stages the NSIS artifact at this same-origin path. Deployments
// that publish releases elsewhere can override it at build time with Vite env.
export const WINDOWS_INSTALLER_URL = configuredInstallerUrl || '/downloads/HELIX-Setup.exe'
