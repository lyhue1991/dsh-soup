import { open as openFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export const TEXT_MAX_BYTES = 8 * 1024 * 1024
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const PDF_MAX_BYTES = 20 * 1024 * 1024
export const NB_MAX_BYTES = 20 * 1024 * 1024
export const HTML_ASSET_MAX_BYTES = 4 * 1024 * 1024

const BINARY_SNIFF = 8192
export const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
}

export function extOf(value) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(value || ''))
  return match ? match[1].toLowerCase() : ''
}

export function joinPath(dir, name) {
  return String(dir || '').replace(/[\\/]+$/, '') + '/' + name
}

function failure(prefix, error) {
  return { ok: false, error: prefix + String(error?.message || error) }
}

export function createFileView({ confine, within }) {
  async function writeForEditor(pathArg, contentArg, expectedMtime, expectedSize, sessionId) {
    const target = await confine(pathArg, '保存路径', sessionId)
    const bytes = Buffer.from(typeof contentArg === 'string' ? contentArg : '', 'utf8')
    if (bytes.length > TEXT_MAX_BYTES) return { ok: false, error: '内容超过 ' + TEXT_MAX_BYTES + ' 字节，禁止保存' }
    let before
    try { before = await stat(target) } catch (error) {
      if (error?.code === 'ENOENT') return { ok: false, conflict: true, error: '文件已被删除，保存已取消' }
      return failure('无法读取原文件: ', error)
    }
    if (before.isDirectory()) return { ok: false, error: '目标是目录，不支持保存' }
    if (expectedMtime !== undefined && (Number(expectedMtime) !== before.mtimeMs || Number(expectedSize) !== before.size)) {
      return { ok: false, conflict: true, error: '文件已被其他程序修改，请重新加载后再保存', mtime: before.mtimeMs, size: before.size }
    }
    const temporary = target + '.dsh-soup-' + process.pid + '-' + Date.now() + '-' + randomBytes(4).toString('hex') + '.tmp'
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, target)
      const after = await stat(target)
      return { ok: true, size: after.size, mtime: after.mtimeMs }
    } catch (error) {
      await rm(temporary, { force: true })
      return failure('保存失败: ', error)
    }
  }

  async function readForView(filePath) {
    const target = String(filePath || '')
    if (!target) return { ok: false, error: '缺少路径' }
    let info
    try { info = await stat(target) } catch (error) { return failure('无法读取文件: ', error) }
    if (info.isDirectory()) return { ok: false, error: '目标是目录' }
    const ext = extOf(target)
    if (IMAGE_MIME[ext]) {
      if (info.size > IMAGE_MAX_BYTES) return { ok: true, kind: 'image-too-large', size: info.size, limit: IMAGE_MAX_BYTES }
      try { return { ok: true, kind: 'image', mime: IMAGE_MIME[ext], data: (await readFile(target)).toString('base64'), size: info.size } }
      catch (error) { return failure('无法读取文件: ', error) }
    }
    if (ext === 'pdf') {
      if (info.size > PDF_MAX_BYTES) return { ok: true, kind: 'pdf-too-large', size: info.size, limit: PDF_MAX_BYTES }
      try { return { ok: true, kind: 'pdf', data: (await readFile(target)).toString('base64'), size: info.size } }
      catch (error) { return failure('无法读取文件: ', error) }
    }
    const cap = ext === 'ipynb' ? NB_MAX_BYTES : TEXT_MAX_BYTES
    try {
      const handle = await openFile(target, 'r')
      let read
      let buffer
      try {
        buffer = Buffer.alloc(Math.min(info.size, cap + 1))
        read = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead
      } finally { await handle.close() }
      for (let index = 0; index < Math.min(read, BINARY_SNIFF); index++) if (buffer[index] === 0) return { ok: true, kind: 'binary', size: info.size }
      return { ok: true, kind: 'text', content: buffer.toString('utf8', 0, Math.min(read, cap)), size: info.size, truncated: info.size > cap }
    } catch (error) { return failure('无法读取文件: ', error) }
  }

  async function readRelated(rootPath, relativePath, sessionId) {
    const root = await confine(rootPath, 'HTML 文件路径', sessionId)
    const relative = String(relativePath || '')
    if (!relative || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(relative) || relative.includes('\0') || relative.includes('\\')) {
      return { ok: false, error: 'HTML 依赖必须使用相对文件路径' }
    }
    const base = path.dirname(root)
    const candidate = path.resolve(base, relative)
    if (!within(base, candidate)) return { ok: false, error: 'HTML 依赖超出文档目录' }
    const target = await confine(candidate, 'HTML 依赖路径', sessionId)
    if (!within(base, target)) return { ok: false, error: 'HTML 依赖超出文档目录' }
    let info
    try { info = await stat(target) } catch (error) { return failure('无法读取 HTML 依赖: ', error) }
    if (info.isDirectory()) return { ok: false, error: 'HTML 依赖是目录' }
    if (info.size > HTML_ASSET_MAX_BYTES) return { ok: false, error: 'HTML 依赖超过 ' + HTML_ASSET_MAX_BYTES + ' 字节' }
    try { return { ok: true, data: (await readFile(target)).toString('base64'), size: info.size } }
    catch (error) { return failure('无法读取 HTML 依赖: ', error) }
  }

  return { writeForEditor, readForView, readRelated }
}
