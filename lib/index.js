/**
 * dsh-tree — 宿主半区：资源管理器的文件能力供给器。
 *
 * 通过 `webServer` 注册一个同源 HTTP 路由 `/api/dsh-tree`（POST JSON），
 * 为浏览器半区提供对文件系统的只具名操作：列目录、系统打开、移到废纸篓、
 * 移动/重命名、新建、上传。永久插件（profile bundle）不经过动态 runner，
 * 因此不依赖 dynamic 半区的 `harness.handle`/`host.call`，而是走
 * 宿主 HTTP 路由 + 浏览器 `fetch` 的规范桥梁。
 */

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'dsh-tree'

/** 注入的宿主服务。 */
export const inject = ['webServer', 'fs', 'subprocess', 'sandboxPolicy', 'sessions']

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

/** POSIX 单引号安全转义。 */
function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`
}

/**
 * 应用宿主半区：注册文件操作路由。
 * @param ctx - cordis 宿主上下文。
 */
export function apply(ctx) {
  const fs = ctx.fs
  const subprocess = ctx.subprocess
  const sessions = ctx.sessions
  const root = (ctx.sandboxPolicy && ctx.sandboxPolicy.workspaceRoot) || '/'

  /** 运行一条命令并返回退出码或错误。 */
  async function runCmd(argv) {
    try {
      const proc = subprocess.spawn({
        argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: { maxBytes: 4096 } },
        graceMs: 6000,
      })
      const outcome = await proc.done
      return { code: outcome.exitCode }
    } catch (err) {
      return { error: String((err && err.message) || err) }
    }
  }

  /** 统一路由 dispatch：每个 action 返回可 JSON 序列化的结果。 */
  async function handleAction(body) {
    const action = body && body.action
    const args = (body && body.args) || {}
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
        const path = String(args.path || root)
        const target = await fs.resolve(path, { cwd: root })
        let entries
        try {
          entries = await fs.listDir(target)
        } catch (err) {
          return { ok: false, error: `无法读取目录: ${String((err && err.message) || err)}` }
        }
        const out = entries.map((entry) => {
          const item = {
            name: entry.name,
            type: entry.type,
            path: entry.target && entry.target.displayPath ? entry.target.displayPath : `${path}/${entry.name}`,
          }
          if (typeof entry.size === 'number' && entry.size >= 0) item.size = entry.size
          return item
        })
        return { ok: true, root, path: target.displayPath, entries: out }
      }
      case 'open': {
        const res = await runCmd(['/usr/bin/open', String(args.path)])
        return res.code === 0 ? { ok: true } : { ok: false, error: res.error || '打开失败' }
      }
      case 'trash': {
        const p = String(args.path).replace(/"/g, '\\"')
        const script = `tell application "Finder" to delete POSIX file "${p}"`
        const res = await runCmd(['/usr/bin/osascript', '-e', script])
        return res.code === 0
          ? { ok: true }
          : { ok: false, error: res.error || '移动失败', hint: '如需移到废纸篓，请在 系统设置→隐私与安全性→自动化 中允许 DSH 控制 Finder' }
      }
      case 'move': {
        const from = String((args && args.from) || '')
        const to = String((args && args.to) || '')
        if (!from || !to) return { ok: false, error: '缺少路径' }
        const res = await runCmd(['/bin/sh', '-c', `/bin/mv ${shellQuote(from)} ${shellQuote(to)}`])
        return res.code === 0 ? { ok: true } : { ok: false, error: res.error || '移动/重命名失败' }
      }
      case 'create': {
        const dir = String((args && args.dir) || '')
        const newName = String((args && args.name) || '')
        const isDir = Boolean(args && args.isDir)
        if (!dir || !newName || newName === '.' || newName === '..' || newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
          return { ok: false, error: '无效文件名' }
        }
        const target = String(dir).replace(/\/+$/, '') + '/' + newName
        const cmd = isDir ? `/bin/mkdir -p ${shellQuote(target)}` : `/usr/bin/touch ${shellQuote(target)}`
        const res = await runCmd(['/bin/sh', '-c', cmd])
        return res.code === 0 ? { ok: true, path: target } : { ok: false, error: res.error || (isDir ? '新建文件夹失败' : '新建文件失败') }
      }
      case 'upload': {
        const dir = String((args && args.dir) || '')
        const fileName = String((args && args.name) || '')
        const data = String((args && args.data) || '')
        if (!dir || !fileName) return { ok: false, error: '缺少参数' }
        const target = String(dir).replace(/\/+$/, '') + '/' + fileName
        const cmd = `/usr/bin/base64 -D > ${shellQuote(target)}`
        try {
          const proc = subprocess.spawn({
            argv: ['/bin/sh', '-c', cmd],
            cwd: '/',
            stdio: { stdin: { data: data.replace(/\s+/g, '') }, stdout: 'ignore', stderr: { maxBytes: 4096 } },
            graceMs: 30000,
          })
          const outcome = await proc.done
          return outcome.exitCode === 0 ? { ok: true, path: target } : { ok: false, error: '写入失败' }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      }
      default:
        return { ok: false, error: `unknown action: ${String(action)}` }
    }
  }

  /** HTTP 处理器：解析 body → dispatch → JSON 响应。 */
  async function handler(req, res) {
    try {
      const body = await readBody(req)
      const result = await handleAction(body)
      writeJson(res, 200, result)
    } catch (err) {
      writeJson(res, 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-tree', handler }),
    'dsh-tree: file http route',
  )
}
