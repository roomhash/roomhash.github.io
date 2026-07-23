import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'

const PAGE_BASE = 'https://roomhash.github.io/roomlets'
const TRACKED_RELEASES = [
  {
    id: 'org.roomhash.pixel-garden',
    slug: 'pixel-garden',
    source: 'https://raw.githubusercontent.com/roomhash/pixel_garden/main/dist/roomhash.json'
  },
  {
    id: 'org.roomhash.whiteboard',
    slug: 'whiteboard',
    source: 'https://raw.githubusercontent.com/roomhash/whiteboard/main/dist/roomhash.json'
  },
  {
    id: 'org.roomhash.voting',
    slug: 'voting',
    source: 'https://raw.githubusercontent.com/roomhash/voting/main/dist/roomhash.json'
  },
  {
    id: 'org.roomhash.market',
    slug: 'market',
    source: 'https://raw.githubusercontent.com/roomhash/market/main/dist/roomhash.json'
  }
]
const outputRoot = new URL('../roomlets/', import.meta.url)
const stagingRoot = new URL(`../.roomlets-publish-${process.pid}/`, import.meta.url)
const backupRoot = new URL(`../.roomlets-previous-${process.pid}/`, import.meta.url)
const published = []

await rm(stagingRoot, { recursive: true, force: true })
await mkdir(stagingRoot, { recursive: true })

function bencode(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value)
    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes])
  }
  if (typeof value === 'string') return bencode(Buffer.from(value, 'utf8'))
  if (Number.isSafeInteger(value)) return Buffer.from(`i${value}e`)
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')])
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right))
    )
    return Buffer.concat([
      Buffer.from('d'),
      ...entries.flatMap(([key, item]) => [bencode(key), bencode(item)]),
      Buffer.from('e')
    ])
  }
  throw new TypeError(`unsupported bencode value: ${typeof value}`)
}

function bdecode(input) {
  const bytes = Buffer.from(input)
  let offset = 0

  function parse() {
    const marker = bytes[offset]
    if (marker === 0x69) {
      const end = bytes.indexOf(0x65, ++offset)
      if (end < 0) throw new Error('unterminated torrent integer')
      const value = Number(bytes.subarray(offset, end).toString('ascii'))
      if (!Number.isSafeInteger(value)) throw new Error('invalid torrent integer')
      offset = end + 1
      return value
    }
    if (marker === 0x6c) {
      const values = []
      offset += 1
      while (bytes[offset] !== 0x65) values.push(parse())
      offset += 1
      return values
    }
    if (marker === 0x64) {
      const value = {}
      offset += 1
      while (bytes[offset] !== 0x65) {
        const key = parse().toString('utf8')
        value[key] = parse()
      }
      offset += 1
      return value
    }
    if (marker >= 0x30 && marker <= 0x39) {
      const colon = bytes.indexOf(0x3a, offset)
      if (colon < 0) throw new Error('invalid torrent byte string')
      const length = Number(bytes.subarray(offset, colon).toString('ascii'))
      const start = colon + 1
      const end = start + length
      if (!Number.isSafeInteger(length) || length < 0 || end > bytes.length) {
        throw new Error('invalid torrent byte string length')
      }
      offset = end
      return bytes.subarray(start, end)
    }
    throw new Error(`unexpected torrent marker at ${offset}`)
  }

  const value = parse()
  if (offset !== bytes.length) throw new Error('trailing torrent bytes')
  return value
}

async function request(url, type) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${type} request failed (${response.status}): ${url}`)
  return response
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function torrentInfoHash(torrent) {
  return createHash('sha1').update(bencode(torrent.info)).digest('hex')
}

function verifyTorrentPieces(torrent, contents) {
  const pieceLength = Number(torrent.info?.['piece length'])
  const expected = Buffer.from(torrent.info?.pieces || [])
  if (!Number.isSafeInteger(pieceLength) || pieceLength <= 0 || expected.length % 20 !== 0) {
    throw new Error('invalid torrent piece metadata')
  }
  const actual = []
  for (let offset = 0; offset < contents.length; offset += pieceLength) {
    actual.push(createHash('sha1').update(contents.subarray(offset, offset + pieceLength)).digest())
  }
  if (!Buffer.concat(actual).equals(expected)) throw new Error('torrent pieces do not match WASM')
}

for (const release of TRACKED_RELEASES) {
  const sourceResponse = await request(release.source, 'manifest')
  const manifest = await sourceResponse.json()
  if (manifest.schema !== 'roomhash.app/v1' || manifest.id !== release.id || manifest.runtime !== 'wasm') {
    throw new Error(`invalid source manifest: ${release.id}`)
  }
  const entry = String(manifest.entry || '')
  const torrentFile = String(manifest.distribution?.torrent || '')
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(entry) || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(torrentFile)) {
    throw new Error(`unsafe release filenames: ${release.id}`)
  }

  const sourceBase = new URL('.', release.source)
  const sourceWasm = new URL(entry, sourceBase)
  const sourceTorrent = new URL(torrentFile, sourceBase)
  const [wasmResponse, torrentResponse] = await Promise.all([
    request(sourceWasm, 'WASM'),
    request(sourceTorrent, 'torrent')
  ])
  const wasm = Buffer.from(await wasmResponse.arrayBuffer())
  const torrent = bdecode(await torrentResponse.arrayBuffer())
  const infoHash = torrentInfoHash(torrent)
  verifyTorrentPieces(torrent, wasm)
  const releaseHash = sha256(wasm)
  if (
    releaseHash !== String(manifest.sha256 || '').toLowerCase() ||
    Number(torrent.info?.length) !== wasm.length ||
    torrent.info?.name?.toString('utf8') !== entry ||
    infoHash !== String(manifest.distribution?.infoHash || '').toLowerCase()
  ) {
    throw new Error(`source release fingerprint mismatch: ${release.id}`)
  }

  const pageDirectory = `${PAGE_BASE}/${release.slug}/${releaseHash}`
  const webSeed = `${pageDirectory}/${entry}`
  const exactSource = `${pageDirectory}/${torrentFile}`
  torrent['url-list'] = [Buffer.from(webSeed)]
  if (torrent['x-roomhash-exact-source']) {
    torrent['x-roomhash-exact-source'] = Buffer.from(exactSource)
  }
  if (torrentInfoHash(torrent) !== infoHash) {
    throw new Error(`HTTP Seed rewrite changed info hash: ${release.id}`)
  }

  const magnet = new URL(manifest.distribution.magnet)
  magnet.searchParams.set('xt', `urn:btih:${infoHash}`)
  magnet.searchParams.set('dn', entry)
  magnet.searchParams.set('ws', webSeed)
  magnet.searchParams.set('xs', exactSource)
  manifest.distribution = {
    torrent: torrentFile,
    infoHash,
    entrySize: wasm.length,
    webSeed,
    exactSource,
    magnet: magnet.href
  }

  const target = new URL(`${release.slug}/${releaseHash}/`, stagingRoot)
  await mkdir(target, { recursive: true })
  await Promise.all([
    writeFile(new URL(entry, target), wasm),
    writeFile(new URL(torrentFile, target), bencode(torrent)),
    writeFile(new URL('roomhash.json', target), `${JSON.stringify(manifest, null, 2)}\n`)
  ])
  published.push({
    id: release.id,
    manifestUrl: `./${release.slug}/${releaseHash}/roomhash.json`
  })
  console.log(`${release.id}: ${wasm.length} bytes, sha256 ${manifest.sha256}, infoHash ${infoHash}`)
}

const catalog = {
  schema: 'roomhash.roomlets/v1',
  roomlets: published
}
await writeFile(new URL('catalog.json', stagingRoot), `${JSON.stringify(catalog, null, 2)}\n`)

// Ensure publication did not accidentally include source or documentation.
const catalogBytes = await readFile(new URL('catalog.json', stagingRoot))
if (!catalogBytes.includes(Buffer.from('roomhash.roomlets/v1'))) {
  throw new Error('Roomlet catalog publication failed')
}

await rm(backupRoot, { recursive: true, force: true })
let hadPreviousPublication = true
try {
  await access(outputRoot)
} catch {
  hadPreviousPublication = false
}
if (hadPreviousPublication) await rename(outputRoot, backupRoot)
try {
  await rename(stagingRoot, outputRoot)
} catch (error) {
  if (hadPreviousPublication) await rename(backupRoot, outputRoot)
  throw error
}
await rm(backupRoot, { recursive: true, force: true })
