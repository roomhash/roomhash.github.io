import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderMessageHtml, safeDataUrl } from '../src/ui.js'

describe('UI rendering safety', () => {
  it('renders shipped base64 file URLs', () => {
    const url = 'data:text/plain;base64,aGVsbG8='
    assert.equal(safeDataUrl(url, 'text/plain'), url)
    const html = renderMessageHtml({
      id: 'file-1',
      type: 'file',
      nickname: 'Alice',
      ts: 1,
      file: { name: 'hello.txt', mime: 'text/plain', size: 5 },
      dataUrl: url
    })
    assert.match(html, /href="data:text\/plain;base64,aGVsbG8="/)
  })

  it('drops injected or MIME-mismatched data URLs', () => {
    const html = renderMessageHtml({
      id: 'file-2',
      type: 'file',
      nickname: 'Mallory',
      ts: 1,
      file: { name: 'x\" onerror=\"alert(1).png', mime: 'image/png', size: 1 },
      dataUrl: 'data:image/png;base64,AAAA\" onerror=\"alert(1)'
    })
    assert.doesNotMatch(html, /src=/)
    assert.doesNotMatch(html, /\sonerror="/)
    assert.match(html, /x&quot; onerror=&quot;/)
    assert.equal(safeDataUrl('javascript:alert(1)', 'text/plain'), '')
    assert.equal(
      safeDataUrl('data:text/html;base64,PGgxPng8L2gxPg==', 'image/png'),
      ''
    )
  })
})
