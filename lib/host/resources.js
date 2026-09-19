import { open as openFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { extOf, IMAGE_MAX_BYTES, IMAGE_MIME } from './file-view.js'

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7E]|["\\;\r\n]/g, '_') || 'download'
  return 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(name)
}

export function createResourceRoutes({ confine, writeJson }) {
  const tickets = new Map()

  function reap() {
    const now = Date.now()
    for (const [token, entry] of tickets) if (entry.exp < now) tickets.delete(token)
  }

  async function issueDownload(filePath, sessionId) {
    const target = await confine(filePath, '下载路径', sessionId)
    let info
    try { info = await stat(target) } catch { return { ok: false, error: '无法读取文件' } }
    if (info.isDirectory()) return { ok: false, error: '目标是目录，不支持下载' }
    const token = randomBytes(24).toString('hex')
    tickets.set(token, { path: target, name: path.basename(target), exp: Date.now() + 120000 })
    return { ok: true, name: path.basename(target), size: info.size, url: '/api/dsh-soup/dl?t=' + token }
  }

  async function downloadHandler(req, res) {
    try {
      const token = new URL(req.url || '/?t=', 'http://local').searchParams.get('t') || ''
      const entry = tickets.get(token)
      if (!entry) { writeJson(res, 404, { ok: false, error: '下载票据无效或已使用' }); return }
      tickets.delete(token)
      const info = await stat(entry.path)
      res.writeHead(200, {
        'content-type': 'application/octet-stream', 'content-length': String(info.size),
        'content-disposition': contentDisposition(entry.name), 'cache-control': 'no-store',
      })
      const stream = createReadStream(entry.path)
      req.on('close', () => stream.destroy())
      stream.pipe(res)
    } catch (error) {
      if (!res.headersSent) writeJson(res, 500, { ok: false, error: String(error?.message || error) })
      else res.end()
    }
  }

  async function imageHandler(req, res) {
    try {
      if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') {
        writeJson(res, 403, { ok: false, error: '跨站图片请求已拒绝' }); return
      }
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin) {
        let originHost = ''
        try { originHost = new URL(origin).host } catch { originHost = '' }
        if (!originHost || originHost !== String(req.headers.host || '')) {
          writeJson(res, 403, { ok: false, error: '跨源图片请求已拒绝' }); return
        }
      }
      let requested = ''
      try { requested = new URL(req.url || '/img?', 'http://local').searchParams.get('p') || '' } catch { /* invalid URL */ }
      if (!requested) { writeJson(res, 400, { ok: false, error: '缺少图片路径' }); return }
      const target = await confine(requested, '图片路径')
      const mime = IMAGE_MIME[extOf(target)]
      if (!mime) { writeJson(res, 415, { ok: false, error: '不是可预览的图片类型' }); return }
      let info
      try { info = await stat(target) } catch { writeJson(res, 404, { ok: false, error: '图片不可读' }); return }
      if (info.isDirectory() || info.size > IMAGE_MAX_BYTES) { writeJson(res, 413, { ok: false, error: '图片过大或目标为目录' }); return }
      const handle = await openFile(target, 'r')
      let bytes
      try { bytes = Buffer.alloc(info.size); await handle.read(bytes, 0, info.size, 0) } finally { await handle.close() }
      res.writeHead(200, { 'content-type': mime, 'content-length': String(info.size), 'cache-control': 'no-store' })
      res.end(bytes)
    } catch (error) {
      if (!res.headersSent) writeJson(res, error?.statusCode || 500, { ok: false, error: String(error?.message || error) })
      else res.end()
    }
  }

  return { reap, issueDownload, downloadHandler, imageHandler }
}
