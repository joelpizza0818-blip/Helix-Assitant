const MEDIA_TYPES = new Set(['audio', 'video'])

export function isTrustedRendererRequest(
  topLevelUrl: string,
  securityOrigin: string | undefined,
  rendererUrl: string,
): boolean {
  try {
    const topLevel = new URL(topLevelUrl)
    const renderer = new URL(rendererUrl)
    const origin = securityOrigin ? new URL(securityOrigin) : null

    if (renderer.protocol === 'file:') {
      return topLevel.protocol === 'file:'
        && topLevel.pathname === renderer.pathname
        && origin?.protocol === 'file:'
    }

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
