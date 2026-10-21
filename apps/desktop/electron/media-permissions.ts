const MEDIA_TYPES = new Set(['audio', 'video'])

export function isTrustedRendererRequest(
  topLevelUrl: string,
  securityOrigin: string | undefined,
  rendererUrl: string,
): boolean {
  try {
    const topLevel = new URL(topLevelUrl)
    const renderer = new URL(rendererUrl)

    if (renderer.protocol === 'file:') {
      // In production, Chromium gives file:// schemes an opaque origin ('null' or 'file://')
      const topLevelPath = decodeURIComponent(topLevel.pathname).toLowerCase().replace(/\\/g, '/')
      const rendererPath = decodeURIComponent(renderer.pathname).toLowerCase().replace(/\\/g, '/')
      if (topLevel.protocol !== 'file:' || topLevelPath !== rendererPath) {
        return false
      }
      if (!securityOrigin || securityOrigin === 'null' || securityOrigin === 'file://') {
        return true
      }
      try {
        const origin = new URL(securityOrigin)
        return origin.protocol === 'file:'
      } catch {
        return false
      }
    }

    const origin = securityOrigin ? new URL(securityOrigin) : null
    return topLevel.origin === renderer.origin
      && origin?.origin === renderer.origin
  } catch {
    return false
  }
}

export function isSupportedMediaRequest(mediaTypes: readonly string[] | undefined): boolean {
  return Boolean(
    mediaTypes?.length
    && mediaTypes.every((mediaType) => MEDIA_TYPES.has(mediaType)),
  )
}

export function isSupportedMediaType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && MEDIA_TYPES.has(mediaType)
}
