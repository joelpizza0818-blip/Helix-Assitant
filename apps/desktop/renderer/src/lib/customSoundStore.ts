export type CustomSoundKind = 'success' | 'error'

export interface CustomSoundMetadata {
  name: string
  size: number
  type: string
}

interface StoredCustomSound extends CustomSoundMetadata {
  kind: CustomSoundKind
  blob: Blob
  updatedAt: number
}

const DATABASE_NAME = 'helix-sound-effects'
const DATABASE_VERSION = 1
const STORE_NAME = 'custom-sounds'
const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_FILE_NAME = /\.(mp3|wav|ogg|m4a|aac|mp4|webm|flac)$/i

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Local sound storage is unavailable in this environment.'))
  }
  if (databasePromise) return databasePromise

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'kind' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local sound storage.'))
    request.onblocked = () => reject(new Error('Local sound storage is blocked by another HELIX window.'))
  })
  const cachedPromise = opening.catch((error: unknown) => {
    databasePromise = null
    throw error
  })
  databasePromise = cachedPromise
  return cachedPromise
}

function validateFile(file: File): void {
  if (!ALLOWED_FILE_NAME.test(file.name)) {
    throw new Error('Choose an audio file or an MP4 file with an audio track.')
  }
  if (file.size === 0) throw new Error('The selected sound file is empty.')
  if (file.size > MAX_FILE_SIZE) throw new Error('Sound files must be 5 MB or smaller.')
  const isMp4 = /\.mp4$/i.test(file.name)
  const isMp4Mime = file.type.startsWith('video/')
    || file.type === 'application/mp4'
    || file.type === 'application/octet-stream'
  if (file.type && !file.type.startsWith('audio/') && !(isMp4 && isMp4Mime)) {
    throw new Error('The selected file is not a supported audio file.')
  }
}

export async function saveCustomSound(kind: CustomSoundKind, file: File): Promise<void> {
  validateFile(file)
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({
      kind,
      name: file.name,
      size: file.size,
      type: file.type,
      blob: file,
      updatedAt: Date.now(),
    } satisfies StoredCustomSound)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the selected sound.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the selected sound was interrupted.'))
  })
}

export async function getCustomSound(kind: CustomSoundKind): Promise<Blob | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(kind)
    request.onsuccess = () => resolve((request.result as StoredCustomSound | undefined)?.blob ?? null)
    request.onerror = () => reject(request.error ?? new Error('Could not read the selected sound.'))
  })
}

export async function getCustomSoundMetadata(kind: CustomSoundKind): Promise<CustomSoundMetadata | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(kind)
    request.onsuccess = () => {
      const sound = request.result as StoredCustomSound | undefined
      resolve(sound ? { name: sound.name, size: sound.size, type: sound.type } : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not read saved sound details.'))
  })
}

export async function deleteCustomSound(kind: CustomSoundKind): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(kind)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove the saved sound.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Removing the saved sound was interrupted.'))
  })
}
