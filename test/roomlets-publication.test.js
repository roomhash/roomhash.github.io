import { access, readFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../', import.meta.url)

describe('Roomlet publication boundary', () => {
  it('keeps only the lightweight Roomlet index in the Web UI repository', async () => {
    assert.deepEqual(await readdir(new URL('roomlets/', root)), ['catalog.json'])
    await assert.rejects(access(new URL('appstore/', root), constants.F_OK))
    await assert.rejects(access(new URL('demo/wasm/', root), constants.F_OK))
  })

  it('does not hardcode Shared Garden application payloads in demo content', async () => {
    const source = await readFile(new URL('src/demo-content.js', root), 'utf8')
    assert.doesNotMatch(source, /PIXEL_GARDEN|pixel_garden|roomhash\.app\/v1/)
    assert.match(source, /DEMO_VIDEO/)
  })

  it('copies the Roomlet index and no application binaries during the Pages build', async () => {
    const source = await readFile(new URL('vite.config.js', root), 'utf8')
    assert.match(source, /roomlets\/catalog\.json/)
    assert.doesNotMatch(source, /appstore|demo\/wasm|cpSync/)
  })
})
