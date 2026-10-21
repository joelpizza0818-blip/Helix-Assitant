export const MAX_CHAT_ATTACHMENTS = 10
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const CHAT_ATTACHMENT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,.txt,.md,.json,.csv,.pdf,.doc,.docx,.js,.ts,.py,.html,.css'

const supportedImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

const imageMimeTypesByExtension: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export interface AttachmentFileMetadata {
  name: string
  size: number
  type: string
}

export function validateAttachmentSelection(
  existing: readonly AttachmentFileMetadata[],
  incoming: readonly AttachmentFileMetadata[],
): string | null {
  const selection = [...existing, ...incoming]
  if (selection.length > MAX_CHAT_ATTACHMENTS) {
    return `Attach no more than ${MAX_CHAT_ATTACHMENTS} files at a time.`
  }

  const totalSize = selection.reduce((sum, file) => sum + file.size, 0)
  if (totalSize > MAX_CHAT_ATTACHMENT_BYTES) {
    return 'Attachments must total 8 MB or less.'
  }

  const unsupportedImage = incoming.find((file) => (
    file.type.toLowerCase().startsWith('image/')
      && !supportedImageTypes.has(file.type.toLowerCase())
  ))
  if (unsupportedImage) {
    return `The image format for "${unsupportedImage.name}" is not supported. Use JPEG, PNG, GIF, or WebP.`
  }

  return null
}

export function getAttachmentMimeType(file: AttachmentFileMetadata): string {
  const declaredType = file.type.toLowerCase()
  if (declaredType) return declaredType

  const extension = file.name.match(/\.[^.]+$/)?.[0]?.toLowerCase()
  return imageMimeTypesByExtension[extension ?? ''] ?? 'application/octet-stream'
}
