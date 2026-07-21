const DB_NAME = 'roomhash-torrent-cache'
const DB_VERSION = 1
const STORE_NAME = 'seeds'

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

function copyBuffer(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value?.buffer || value || 0)
  return bytes.slice().buffer
}

export class TorrentSeedCache {
  constructor(indexedDb = globalThis.indexedDB) {
    this.indexedDb = indexedDb
    this.dbPromise = null
  }

  get supported() {
    return Boolean(this.indexedDb)
  }

  async open() {
    if (!this.supported) return null
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.indexedDb.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'infoHash' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Unable to open torrent cache'))
    })
    return this.dbPromise
  }

  async list() {
    const db = await this.open()
    if (!db) return []
    const transaction = db.transaction(STORE_NAME, 'readonly')
    return requestResult(transaction.objectStore(STORE_NAME).getAll())
  }

  async get(infoHash) {
    const db = await this.open()
    if (!db) return null
    const transaction = db.transaction(STORE_NAME, 'readonly')
    return requestResult(transaction.objectStore(STORE_NAME).get(infoHash))
  }

  async storeTorrent(torrent) {
    if (!this.supported || !torrent?.infoHash || !torrent?.torrentFile) return false
    const files = await Promise.all(torrent.files.map(async (file) => {
      const blob = await file.blob()
      return {
        path: file.path || file.name,
        name: file.name,
        type: file.type || blob.type || '',
        length: file.length,
        blob
      }
    }))
    const record = {
      infoHash: torrent.infoHash,
      magnetURI: torrent.magnetURI,
      name: torrent.name || '',
      torrentFile: copyBuffer(torrent.torrentFile),
      files,
      updatedAt: Date.now()
    }
    const db = await this.open()
    if (!db) return false
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORE_NAME).put(record)
    await done
    return true
  }

  async remove(infoHash) {
    const db = await this.open()
    if (!db) return
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore(STORE_NAME).delete(infoHash)
    await done
  }
}
