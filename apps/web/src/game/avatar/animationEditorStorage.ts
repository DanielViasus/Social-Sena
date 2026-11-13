import type { AnimationPart } from './layeredAvatar'

export interface EditorImageLayer {
  id: string
  name: string
  url: string
  visible: boolean
  x: number
  y: number
  rotation: number
  rotationX: number
  rotationY: number
  pivotX: number
  pivotY: number
  // Avatar part this layer stands for, so a skin can swap its image. Optional: older records lack it.
  part?: AnimationPart
}

export interface EditorFrame {
  id: string
  durationMs: number
  layers: EditorImageLayer[] // Frontmost image first.
}

export interface AnimationEditorDocument {
  frames: EditorFrame[]
  sceneSize: { width: number; height: number }
}

export interface SavedAnimation {
  version: 1
  id: string
  name: string
  type: 'skin'
  updatedAt: string
  document: AnimationEditorDocument
}

export type AnimationSummary = Pick<SavedAnimation, 'id' | 'name' | 'updatedAt'>

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('social-sena-animation-editor', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('animations', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'))
    request.onblocked = () => reject(new Error('Cierra las otras pestañas del editor e inténtalo nuevamente.'))
  })
}

async function readRecords<T>(run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('animations', 'readonly')
    const request = run(transaction.objectStore('animations'))
    transaction.oncomplete = () => { db.close(); resolve(request.result) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('No se pudo leer la animación.')) }
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo guardar una imagen.'))
    reader.readAsDataURL(blob)
  })
}

// Embed images, including bundled assets, so records survive reloads and builds.
export async function embedAnimationImages(document: AnimationEditorDocument): Promise<AnimationEditorDocument> {
  const sources = [...new Set(document.frames.flatMap((frame) => frame.layers.map((layer) => layer.url)))]
  const images = new Map(await Promise.all(sources.map(async (url): Promise<[string, string]> => {
    if (url.startsWith('data:image/')) return [url, url]
    const response = await fetch(url)
    if (!response.ok) throw new Error('No se pudo leer una de las imágenes. No se guardaron los cambios.')
    return [url, await blobToDataUrl(await response.blob())]
  })))
  return {
    sceneSize: { ...document.sceneSize },
    frames: document.frames.map((frame) => ({
      ...frame,
      layers: frame.layers.map((layer) => ({ ...layer, url: images.get(layer.url)! })),
    })),
  }
}

export async function saveAnimation(animation: SavedAnimation) {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('animations', 'readwrite')
    transaction.objectStore('animations').put(animation)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('No se pudo guardar la animación.')) }
  })
}

export async function listAnimations(): Promise<AnimationSummary[]> {
  const records = await readRecords<SavedAnimation[]>((store) => store.getAll())
  return records.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteAnimation(id: string): Promise<void> {
  const db = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('animations', 'readwrite')
    transaction.objectStore('animations').delete(id)
    transaction.oncomplete = () => { db.close(); resolve() }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('No se pudo eliminar la animación.')) }
  })
}

export async function loadAnimation(id: string): Promise<SavedAnimation> {
  const record = await readRecords<SavedAnimation | undefined>((store) => store.get(id))
  if (!record || record.version !== 1 || record.type !== 'skin' || !record.document.frames.length) {
    throw new Error('La animación no existe o su formato no es compatible.')
  }
  return {
    ...record,
    document: {
      ...record.document,
      frames: record.document.frames.map((frame) => ({
        ...frame,
        layers: frame.layers.map((layer) => ({
          ...layer,
          pivotX: layer.pivotX ?? 0,
          pivotY: layer.pivotY ?? 0,
        })),
      })),
    },
  }
}
