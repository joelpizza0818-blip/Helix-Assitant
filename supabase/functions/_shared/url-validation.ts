export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  const candidate = value.trim()
  if (!candidate || /[\u0000-\u001F\u007F]/.test(candidate)) return false
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:'
      && Boolean(url.hostname)
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

export function isAllowedAnnouncementUrl(value: string): boolean {
  const candidate = value.trim()
  if (!candidate || /[\u0000-\u001F\u007F]/.test(candidate) || /%(?:2f|5c)/i.test(candidate)) return false
  if (!candidate.startsWith('/')) return isHttpsUrl(candidate)
  try {
    return !candidate.startsWith('//')
      && new URL(candidate, 'https://helix.invalid').origin === 'https://helix.invalid'
  } catch {
    return false
  }
}

export function isExternalAnnouncementUrl(value: string): boolean {
  return isAllowedAnnouncementUrl(value) && !value.trim().startsWith('/')
}
