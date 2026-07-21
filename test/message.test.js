import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FileAssembler,
  bytesToDataUrl,
  createFileMessage,
  createModuleMessage,
  createTextMessage,
  deserializeMessage,
  frameFileTransfer,
  normalizeMimeType,
  serializeMessage
} from '../src/message.js'

describe('message framing (shipped)', () => {
  it('text payload round-trips', () => {
    const msg = createTextMessage({
      text: 'hello room',
      nickname: 'SwiftFox42',
      peerId: 'peer-a',
      local: true
    })
    const wire = serializeMessage(msg)
    const back = deserializeMessage(wire)
    assert.equal(back.type, 'text')
    assert.equal(back.text, 'hello room')
    assert.equal(back.nickname, 'SwiftFox42')
    assert.equal(back.id, msg.id)
    assert.equal(back.ts, msg.ts)
  })

  it('file metadata payload round-trips', () => {
    const msg = createFileMessage({
      nickname: 'NeonOwl11',
      file: { name: 'photo.png', mime: 'image/png', size: 12 },
      dataUrl: 'data:image/png;base64,AAAA'
    })
    const wire = serializeMessage(msg)
    const back = deserializeMessage(wire)
    assert.equal(back.type, 'file')
    assert.equal(back.file.name, 'photo.png')
    assert.equal(back.file.mime, 'image/png')
    assert.equal(back.file.size, 12)
    assert.equal(back.dataUrl, 'data:image/png;base64,AAAA')
  })

  it('module payload round-trips as JSON data', () => {
    const msg = createModuleMessage({
      module: 'torrent.media',
      moduleVersion: 1,
      nickname: 'Seeder',
      payload: { magnet: 'magnet:?xt=urn:btih:abc', files: [{ name: 'movie.mp4' }] }
    })
    const back = deserializeMessage(serializeMessage(msg))
    assert.equal(back.type, 'module')
    assert.equal(back.module, 'torrent.media')
    assert.equal(back.payload.files[0].name, 'movie.mp4')
  })

  it('rejects empty text', () => {
    assert.throws(() => createTextMessage({ text: '  ', nickname: 'x' }))
  })

  it('chunk assembly reconstructs bytes', () => {
    const payload = new TextEncoder().encode('file-bytes-payload-✓')
    const framed = frameFileTransfer(
      {
        transferId: 't1',
        name: 'note.txt',
        mime: 'text/plain',
        size: payload.length,
        chunkSize: 4
      },
      payload
    )
    const asm = new FileAssembler()
    assert.equal(asm.push(framed.meta).done, false)
    for (const c of framed.chunks) {
      assert.equal(asm.push(c).done, false)
    }
    const done = asm.push(framed.end)
    assert.equal(done.done, true)
    assert.equal(done.name, 'note.txt')
    assert.equal(done.mime, 'text/plain')
    assert.deepEqual([...done.bytes], [...payload])
  })

  it('bytesToDataUrl produces data URL', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const url = bytesToDataUrl(bytes, 'application/octet-stream')
    assert.ok(url.startsWith('data:application/octet-stream;base64,'))
  })

  it('normalizes unsafe MIME metadata before creating data URLs', () => {
    assert.equal(normalizeMimeType('IMAGE/PNG'), 'image/png')
    assert.equal(
      normalizeMimeType('image/png\" onerror=\"alert(1)'),
      'application/octet-stream'
    )
    assert.equal(
      bytesToDataUrl(new Uint8Array([1]), 'text/plain\" onclick=\"x'),
      'data:application/octet-stream;base64,AQ=='
    )
  })
})
