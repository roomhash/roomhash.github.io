export const ROOMLET_CATALOG_URL = './roomlets/catalog.json'

const RUNTIMES = new Set(['wasm'])
const METADATA_LOCALES = ['en', 'zh-CN']
const METADATA_FIELDS = { name: 120, summary: 320, description: 320, notice: 480, privacy: 480 }
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]{0,127}$/i
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,158}[a-z0-9])?$/i
const SHA256 = /^[a-f0-9]{64}$/i
const INFO_HASH = /^[a-f0-9]{40}$/i
let defaultCatalogLoad = null

function string(value, name, max = 240) {
  const result = String(value ?? '').trim()
  if (!result || result.length > max) throw new Error(`invalid Roomlet ${name}`)
  return result
}

function httpsUrl(value, name, base) {
  let result
  try {
    result = new URL(string(value, name, 2048), base)
  } catch {
    throw new Error(`invalid Roomlet ${name}`)
  }
  if (result.protocol !== 'https:') throw new Error(`invalid Roomlet ${name}`)
  result.hash = ''
  return result
}

function normalizeI18n(input) {
  if (input == null) return Object.freeze({})
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid Roomlet i18n metadata')
  }
  const result = {}
  for (const locale of METADATA_LOCALES) {
    const source = input[locale]
    if (source == null) continue
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error(`invalid Roomlet i18n metadata for ${locale}`)
    }
    const translated = {}
    for (const [field, max] of Object.entries(METADATA_FIELDS)) {
      if (source[field] == null || source[field] === '') continue
      translated[field] = string(source[field], `${locale}.${field}`, max)
    }
    if (!translated.name) throw new Error(`invalid Roomlet i18n name for ${locale}`)
    result[locale] = Object.freeze(translated)
  }
  return Object.freeze(result)
}

export function localizeRoomletMetadata(metadata, language = 'en') {
  const locale = String(language).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
  const translated = metadata?.i18n?.[locale] || metadata?.i18n?.en || {}
  const localized = {}
  for (const field of Object.keys(METADATA_FIELDS)) {
    localized[field] = String(translated[field] || metadata?.[field] || '').trim()
  }
  localized.summary = String(
    translated.summary || translated.description || metadata?.summary || metadata?.description || ''
  ).trim()
  return Object.freeze(localized)
}

export function normalizeRoomletReference(input, base = 'https://roomhash.github.io/') {
  const id = string(input?.id, 'id', 160)
  if (!SAFE_ID.test(id)) throw new Error('invalid Roomlet id')
  return Object.freeze({
    id,
    manifestUrl: httpsUrl(input?.manifestUrl, 'manifest URL', base).href
  })
}

export function normalizeRoomletCatalog(input, base) {
  if (input?.schema !== 'roomhash.roomlets/v1' || !Array.isArray(input.roomlets)) {
    throw new Error('invalid Roomlet catalog')
  }
  const roomlets = input.roomlets.map((entry) => normalizeRoomletReference(entry, base))
  if (new Set(roomlets.map((roomlet) => roomlet.id)).size !== roomlets.length) {
    throw new Error('duplicate Roomlet id')
  }
  return Object.freeze(roomlets)
}

export function normalizeRoomletManifest(input, reference) {
  if (input?.schema !== 'roomhash.app/v1') throw new Error('invalid Roomlet manifest')
  const id = string(input.id, 'id', 160)
  if (id !== reference?.id) throw new Error('Roomlet manifest id mismatch')
  const runtime = string(input.runtime, 'runtime', 32)
  if (!RUNTIMES.has(runtime)) throw new Error(`unsupported Roomlet runtime: ${runtime}`)
  const entry = string(input.entry, 'entry', 128)
  if (!SAFE_FILE.test(entry)) throw new Error('unsafe Roomlet artifact file')
  const sha256 = string(input.sha256, 'SHA-256', 64).toLowerCase()
  if (!SHA256.test(sha256)) throw new Error('invalid Roomlet SHA-256')

  const distribution = input.distribution
  const infoHash = string(distribution?.infoHash, 'info hash', 40).toLowerCase()
  if (!INFO_HASH.test(infoHash)) throw new Error('invalid Roomlet info hash')
  const entrySize = Number(distribution?.entrySize)
  if (!Number.isSafeInteger(entrySize) || entrySize <= 0) throw new Error('invalid Roomlet entry size')
  const artifactBase = new URL('.', reference.manifestUrl)
  const expectedEntryUrl = new URL(entry, artifactBase).href
  const webSeed = httpsUrl(distribution?.webSeed, 'WebSeed').href
  if (webSeed !== expectedEntryUrl) throw new Error('Roomlet WebSeed is not colocated with its manifest')
  const torrentFile = string(distribution?.torrent, 'torrent filename', 128)
  if (!SAFE_FILE.test(torrentFile)) throw new Error('unsafe Roomlet torrent file')
  const expectedTorrentUrl = new URL(torrentFile, artifactBase).href
  const torrentUrl = httpsUrl(
    distribution?.exactSource || distribution?.torrentUrl,
    'torrent URL'
  ).href
  if (torrentUrl !== expectedTorrentUrl) throw new Error('Roomlet torrent is not colocated with its manifest')

  let magnet
  try {
    magnet = new URL(string(distribution?.magnet, 'magnet', 4096))
  } catch {
    throw new Error('invalid Roomlet magnet')
  }
  if (magnet.protocol !== 'magnet:' || magnet.searchParams.get('xt')?.toLowerCase() !== `urn:btih:${infoHash}`) {
    throw new Error('invalid Roomlet magnet')
  }
  if (magnet.searchParams.get('ws') !== webSeed || magnet.searchParams.get('xs') !== torrentUrl) {
    throw new Error('Roomlet magnet sources do not match its manifest')
  }

  const name = string(input.name, 'name', 120)
  const description = String(input.description || '').trim().slice(0, 320)
  const i18n = normalizeI18n(input.i18n)
  return Object.freeze({
    id,
    name,
    summary: description,
    description,
    i18n,
    runtime,
    entry,
    sha256,
    entrySize,
    infoHash,
    manifestUrl: reference.manifestUrl,
    webSeed,
    torrentUrl,
    magnet: magnet.href,
    manifest: Object.freeze({ ...input, i18n })
  })
}

async function requestCatalog(fetcher) {
  const response = await fetcher(ROOMLET_CATALOG_URL, { cache: 'no-cache' })
  if (!response?.ok) throw new Error(`Roomlet catalog request failed (${response?.status || 0})`)
  const base = response.url || new URL(ROOMLET_CATALOG_URL, globalThis.location?.href || 'https://roomhash.github.io/').href
  const references = normalizeRoomletCatalog(await response.json(), base)
  return Promise.all(references.map(async (reference) => {
    const manifestResponse = await fetcher(reference.manifestUrl, { cache: 'no-cache' })
    if (!manifestResponse?.ok) {
      throw new Error(`Roomlet manifest request failed (${manifestResponse?.status || 0})`)
    }
    return normalizeRoomletManifest(await manifestResponse.json(), reference)
  }))
}

export function loadRoomletCatalog(fetcher = globalThis.fetch) {
  if (typeof fetcher !== 'function') throw new Error('Roomlet catalog fetch is unavailable')
  if (fetcher !== globalThis.fetch) return requestCatalog(fetcher)
  if (!defaultCatalogLoad) {
    defaultCatalogLoad = requestCatalog(fetcher).catch((error) => {
      defaultCatalogLoad = null
      throw error
    })
  }
  return defaultCatalogLoad
}

export function roomletArtifactUrl(roomlet, file = roomlet.entry) {
  if (!SAFE_FILE.test(String(file || ''))) throw new Error('unsafe Roomlet artifact file')
  return new URL(file, new URL('.', roomlet.manifestUrl))
}

export function roomletRuntimeMagnet(roomlet) {
  const magnet = new URL(roomlet.magnet)
  magnet.searchParams.set('ws', roomlet.webSeed)
  magnet.searchParams.set('xs', roomlet.torrentUrl)
  return magnet.href
}
