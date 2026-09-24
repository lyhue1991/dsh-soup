/**
 * dsh-soup — 宿主半区：资源管理器的文件能力供给器。
 *
 * 通过 `webServer` 注册一个同源 HTTP 路由 `/api/dsh-soup`（POST JSON），
 * 为浏览器半区提供对文件系统的只具名操作：列目录、系统打开、移到废纸篓、
 * 移动/重命名、新建、上传。永久插件（profile bundle）不经过动态 runner，
 * 因此不依赖 dynamic 半区的 `harness.handle`/`host.call`，而是走
 * 宿主 HTTP 路由 + 浏览器 `fetch` 的规范桥梁。
 *
 * 跨平台：move/create/upload 直接用 `node:fs/promises`（mac/linux/win 通用），
 * 仅 open/trash 这类"唤起系统"的动作按 `process.platform` 分支选命令。
 */

import { rename, mkdir, writeFile, appendFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createPathGuard } from './host/paths.js'
import { createSystemActions } from './host/system.js'
import { createFileView, joinPath } from './host/file-view.js'
import { createSpeedTracker } from './host/speed.js'
import { createResourceRoutes } from './host/resources.js'

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'ui-dsh-soup'

/** 注入的宿主服务。 */
export const inject = ['webServer', 'fs', 'subprocess', 'sandboxPolicy', 'sessions', 'timer']

/**
 * 读取一次请求体为 JSON 对象（损坏或不存在的 body 返回空对象）。
 * @param req - node:http IncomingMessage。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

/** 写一个 JSON 响应。 */
function writeJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * 应用宿主半区：注册文件操作路由。
 * @param ctx - cordis 宿主上下文。
 */
export function apply(ctx) {
  const fs = ctx.fs
  const subprocess = ctx.subprocess
  const sessions = ctx.sessions
  // 持久化层可选：存在时围栏可为冷会话兜底读取 header cwd（详见 host/paths.js）。
  const persistence = ctx.get ? ctx.get('sessionPersistence') : undefined
  const root = (ctx.sandboxPolicy && ctx.sandboxPolicy.workspaceRoot) || '/'
  const { openPath, trashPath } = createSystemActions({ subprocess })

  // ------------------------------------------------------------------
  // 路径围栏：除 list 走沙箱 fs 外，其余具名文件操作（read/move/
  // trash/open/create/upload）一律先过 confine()，只允许落在
  // 「workspace 根 ∪ 所有已知会话 cwd」的子树内。解析走 realpath，
  // 防符号链接逃逸；容忍目标末级尚不存在（新建/上传/移动目标）。
  // 已知残留：confine 与实际操作之间存在 TOCTOU 窗口（符号链接竞态），
  // Node 可移植 API 下无法根除，见 README 安全模型。
  // ------------------------------------------------------------------
  const pathGuard = createPathGuard({ root, sessions, persistence, platform: process.platform })
  const { within } = pathGuard
  const { readForView, readRelated, writeForEditor } = createFileView({ confine: pathGuard.confine, within })

  // Path validation implementation lives in host/paths; retain local aliases so
  // existing action handlers keep their established call sites and error behavior.
  const { confine } = pathGuard

  const resources = createResourceRoutes({ confine, writeJson })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-soup/dl', handler: resources.downloadHandler }),
    'dsh-soup: streaming download route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-soup/img', handler: resources.imageHandler }),
    'dsh-soup: inline image route',
  )

  // LLM stream instrumentation is isolated from HTTP routing.
  const speed = createSpeedTracker()
  ctx.on('llm/stream', (options, next) => speed.wrap(options, next))
  ctx.effect(ctx.timer.interval(() => speed.reap(), 1000), 'dsh-soup: speed stream reap')

 /** 统一路由 dispatch：每个 action 返回可 JSON 序列化的结果。 */

/** 统一路由 dispatch：每个 action 返回可 JSON 序列化的结果。 */
  async function handleAction(body) {
    const action = body && body.action
    const args = (body && body.args) || {}
    const sessionIdArg = args && args.sessionId ? String(args.sessionId) : undefined
    switch (action) {
      case 'root': {
        return { ok: true, root }
      }
      case 'sessionCwd': {
        const id = args.sessionId
        const session = id ? sessions.get(id) : undefined
        const cwd = session && session.header && session.header.cwd
        return cwd ? { ok: true, cwd } : { ok: false }
      }
      case 'list': {
        const rp = await confine(String(args.path || '') || root, '目录', sessionIdArg)
        let target
        let entries
        try {
          target = await fs.resolve(rp, { cwd: root })
          entries = await fs.listDir(target)
        } catch (err) {
          return { ok: false, error: `无法读取目录: ${String((err && err.message) || err)}` }
        }
        const basePath = (target && target.displayPath) || rp
        const out = entries.map((entry) => {
          const item = {
            name: entry.name,
            type: entry.type,
            path: entry.target && entry.target.displayPath ? entry.target.displayPath : `${basePath}/${entry.name}`,
          }
          if (typeof entry.size === 'number' && entry.size >= 0) item.size = entry.size
          return item
        })
        // 目录在前、文件在后，各按名称排（与 VS Code / Finder 一致）。
        out.sort((a, b) => {
          const dirDiff = (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1)
          if (dirDiff !== 0) return dirDiff
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        })
        return { ok: true, root, path: basePath, entries: out }
      }
      case 'open': {
        const rp = await confine(args.path, '打开路径', sessionIdArg)
        const res = await openPath(rp)
        return res.code === 0 ? { ok: true } : { ok: false, error: res.error || '打开失败' }
      }
      case 'trash': {
        const rp = await confine(args.path, '废纸篓路径', sessionIdArg)
        return trashPath(rp)
      }
      case 'move': {
        const from = String((args && args.from) || '')
        const to = String((args && args.to) || '')
        if (!from || !to) return { ok: false, error: '缺少路径' }
        const fromRp = await confine(from, '源路径', sessionIdArg)
        const toRp = await confine(to, '目标路径', sessionIdArg)
        if (toRp !== fromRp && within(fromRp, toRp)) return { ok: false, error: '不能把文件夹移入其自身子目录' }
        try {
          await rename(fromRp, toRp)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: `移动/重命名失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'create': {
        const dir = String((args && args.dir) || '')
        const newName = String((args && args.name) || '')
        const isDir = Boolean(args && args.isDir)
        if (!dir || !newName || newName === '.' || newName === '..' || newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
          return { ok: false, error: '无效文件名' }
        }
        const dirRp = await confine(dir, '目录', sessionIdArg)
        // 二次围栏：name 若与既有符号链接同名，lenient realpath 会解析出
        // 链接真实指向，越界即拒绝。
        const target = await confine(joinPath(dirRp, newName), '创建路径', sessionIdArg)
        try {
          if (isDir) {
            await mkdir(target, { recursive: true })
          } else {
            await writeFile(target, '')
          }
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `${isDir ? '新建文件夹' : '新建文件'}失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'upload': {
        const dir = String((args && args.dir) || '')
        const fileName = String((args && args.name) || '')
        const data = String((args && args.data) || '')
        // 文件名与 create 同规：禁路径分隔符与相对段，杜绝 ../ 穿越。
        if (!dir || !fileName || fileName === '.' || fileName === '..' || fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0')) {
          return { ok: false, error: '无效文件名' }
        }
        const dirRp = await confine(dir, '目录', sessionIdArg)
        const target = await confine(joinPath(dirRp, fileName), '上传路径', sessionIdArg)
        // 分块上传：首块先做同名冲突检查；客户端确认覆盖后才写入，
        // 后续块追加到已创建的目标。
        const chunk = Number((args && args.chunk) || 0)
        if (chunk < 0 || !Number.isInteger(chunk)) return { ok: false, error: '无效的 chunk 序号' }
        try {
          const bytes = Buffer.from(data.replace(/\s+/g, ''), 'base64')
          if (chunk >= 2) {
            await appendFile(target, bytes)
            return { ok: true, path: target }
          }
          if (!(args && args.overwrite)) {
            try { await stat(target); return { ok: false, conflict: true, error: '目标文件已存在' } } catch (err) {
              if (!err || err.code !== 'ENOENT') throw err
            }
          }
          await writeFile(target, bytes)
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `写入失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'read': {
        const rp = await confine(args.path, '文件路径', sessionIdArg)
        return readForView(rp)
      }
      case 'read-related': {
        return readRelated(args.path, args.relativePath, sessionIdArg)
      }
      case 'write': {
        return writeForEditor(
          args.path,
          args.content,
          args.expectedMtime,
          args.expectedSize,
          sessionIdArg,
        )
      }
      case 'download': {
        // 流式下载签发：围栏校验通过后发一张一次性、2 分钟时效的票据 URL，
        // 真正的字节由 /api/dsh-soup/dl 流式发送——任意大小文件零内存放大。
        return resources.issueDownload(args.path, sessionIdArg)
      }
      case 'mtime': {
        // 轻量变更探测：对一批路径返回 mtime(+size/目录标志)，供浏览器端
        // 低频轮询比较、变了才真正重拉——避免引入跨平台文件 watcher。
        // 上限 64 个路径；越界/不可达的路径返回 null（客户端视为消失）。
        const paths = Array.isArray(args && args.paths) ? args.paths.slice(0, 64) : []
        const mtimes = {}
        for (const raw of paths) {
          const p = String(raw || '')
          if (!p) continue
          try {
            const rp = await confine(p, '探测路径', sessionIdArg)
            const st = await stat(rp)
            mtimes[p] = st.isDirectory() ? { m: st.mtimeMs, d: 1 } : { m: st.mtimeMs, s: st.size }
          } catch {
            mtimes[p] = null
          }
        }
        return { ok: true, mtimes }
      }
      case 'speed-status': {
        const sid = args && args.sessionId ? String(args.sessionId) : ''
        return { ok: true, ...speed.status(sid) }
      }
      default:
        return { ok: false, error: `unknown action: ${String(action)}` }
    }
  }

  /**
   * 请求门：同源校验 + 强制自定义头。
   * - 仅接受 POST；OPTIONS 直接 403（让浏览器 preflight 失败），其余 405；
   * - 带 Origin 时必须与 Host 同源——挡跨站 CSRF 与 DNS rebinding
   *   （rebinding 页面的 Origin 是攻击者域名，与 Host 必不相同）；
   * - 必须携带 x-dsh-soup: 1 且 content-type 为 application/json：
   *   自定义头会强制浏览器先走 preflight，而本路由永不回 CORS 头，
   *   因此恶意网页无法用 text/plain「简单请求」盲打写操作。
   * 非浏览器本地工具（无 Origin 头）不受影响。
   */
  function gate(req, res) {
    const method = String(req.method || 'POST').toUpperCase()
    if (method === 'OPTIONS') {
      writeJson(res, 403, { ok: false, error: 'forbidden' })
      return true
    }
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST')
      writeJson(res, 405, { ok: false, error: '仅支持 POST' })
      return true
    }
    const headers = req.headers || {}
    const origin = headers.origin
    if (typeof origin === 'string' && origin !== '') {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { originHost = '' }
      const host = typeof headers.host === 'string' ? headers.host : ''
      if (!originHost || originHost !== host) {
        writeJson(res, 403, { ok: false, error: '跨源请求已拒绝' })
        return true
      }
    }
    const contentType = String(headers['content-type'] || '').toLowerCase()
    if (headers['x-dsh-soup'] !== '1' || !contentType.startsWith('application/json')) {
      writeJson(res, 403, { ok: false, error: '缺少必要的请求头' })
      return true
    }
    return false
  }

  /** HTTP 处理器：请求门 → 解析 body → dispatch → JSON 响应。 */
  async function handler(req, res) {
    try {
      if (gate(req, res)) return
      const body = await readBody(req)
      const result = await handleAction(body)
      writeJson(res, 200, result)
    } catch (err) {
      writeJson(res, (err && err.statusCode) || 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-soup', handler }),
    'dsh-soup: file http route',
  )
}
