/**
 * Functional tests for lib/client/html-preview.js (DOM required, via jsdom).
 *
 * Covers the sandboxed srcdoc packing pipeline:
 * - relative images (img/source/video poster/srcset/inline CSS url) are
 *   inlined as data URLs through the host read-related RPC;
 * - dedupe: one RPC per unique image path;
 * - missing/absolute/root-relative references are left untouched;
 * - relative scripts/stylesheets keep being packed and inlined with
 *   classic-script ordering preserved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let JSDOM = null
let jsdomError = ''
try { JSDOM = (await import('jsdom')).JSDOM } catch (error) { jsdomError = String(error?.message || error) }

const PNG_1PX_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function makeFixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-soup-html-'))
  await writeFile(path.join(dir, 'img.png'), Buffer.from(PNG_1PX_BASE64, 'base64'))
  // 注意：missing.png 故意不创建，用于验证读取失败时引用保持原样。
  await writeFile(path.join(dir, 'app.js'), 'console.log("packed")')
  await writeFile(path.join(dir, 'style.css'), '.packed{color:red}')
  return dir
}

/** Minimal host-side read-related stand-in: same-directory base64 read. */
function createRpcStub(rootFile) {
  const calls = []
  return {
    calls,
    async rpc(action, args) {
      if (action !== 'read-related') throw new Error('unexpected action: ' + action)
      calls.push(args.relativePath)
      const target = path.resolve(path.dirname(rootFile), args.relativePath)
      if (!target.startsWith(path.dirname(rootFile) + path.sep)) return { ok: false, error: 'out of dir' }
      try {
        const data = (await (await import('node:fs/promises')).readFile(target)).toString('base64')
        return { ok: true, data, size: Buffer.from(data, 'base64').length }
      } catch (error) {
        return { ok: false, error: String(error?.message || error) }
      }
    },
  }
}

test('html preview packs relative images as data URLs', { skip: JSDOM ? false : 'jsdom unavailable: ' + jsdomError }, async () => {
  const dir = await makeFixture()
  try {
    const rootFile = path.join(dir, 'page.html')
    const doc = [
      '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>',
      '<img src="img.png" alt="a">',
      '<img src="img.png" alt="dup">',
      '<img src="missing.png" alt="gone">',
      '<img src="https://example.com/remote.png" alt="remote">',
      '<img src="/absolute.png" alt="root">',
      '<img srcset="img.png 1x, img.png 2x" alt="responsive">',
      '<picture><source srcset="img.png 640w"><img src="img.png" alt="pic"></picture>',
      '<video poster="img.png" src="movie.mp4"></video>',
      '<div style="background:url(img.png) no-repeat">bg</div>',
      '<style>body{background-image:url("img.png")}</style>',
      '<script src="app.js"></script>',
      '</body></html>',
    ].join('\n')
    const stub = createRpcStub(rootFile)

    const dom = new JSDOM('')
    globalThis.document = dom.window.document
    const { packHtmlPreview, inlinePackedHtml, prepareHtmlText } = await import('../lib/client/html-preview.js')

    const controller = new AbortController()
    const bundle = await packHtmlPreview({ text: doc, rootPath: rootFile, sessionId: 's1', rpc: stub.rpc, signal: controller.signal })
    const html = inlinePackedHtml(bundle)

    // 每个唯一路径只发起一次 read-related（img.png 去重）。
    const imgCalls = stub.calls.filter((p) => p === 'img.png')
    assert.equal(imgCalls.length, 1, 'img.png must be fetched once, got ' + stub.calls.join(','))
    assert.ok(stub.calls.includes('app.js') && stub.calls.includes('style.css'), 'scripts/styles still packed')

    const dataUrl = 'data:image/png;base64,' + PNG_1PX_BASE64
    const escaped = dataUrl.replaceAll('/', '\\/')
    const dataUrlCount = html.split(dataUrl).length - 1 + html.split(escaped).length - 1
    // img ×2 + srcset ×2 + picture source ×1 + picture img ×1 + poster ×1 + style attr ×1 + <style> ×1
    assert.ok(dataUrlCount >= 9, 'expected >=9 inlined data URLs, got ' + dataUrlCount)

    // 丢失的本地图、绝对/根相对/外链引用保持原样。
    assert.ok(html.includes('src="missing.png"'), 'missing local image must be left untouched')
    assert.ok(html.includes('https://example.com/remote.png'), 'external image must stay untouched')
    assert.ok(html.includes('"/absolute.png"') || html.includes('src="/absolute.png"'), 'root-relative image must stay untouched')

    // 脚本/样式表内联保持经典脚本顺序。
    assert.ok(html.includes('<style>.packed{color:red}</style>'), 'stylesheet must be inlined as <style>')
    assert.ok(html.includes('console.log("packed")'), 'script must be inlined with its text content')

    // 纯外链文档不走模板重序列化。
    const external = await packHtmlPreview({
      text: '<p>hi</p><img src="https://example.com/x.png">',
      rootPath: rootFile, sessionId: 's1', rpc: stub.rpc, signal: controller.signal,
    })
    assert.equal(external.html, prepareHtmlText('<p>hi</p><img src="https://example.com/x.png">'), 'external-only document must retain its original srcDoc context')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
