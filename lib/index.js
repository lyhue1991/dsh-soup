/**
 * dsh-tree — 宿主半区：资源管理器的文件能力供给器。
 *
 * 通过 `webServer` 注册一个同源 HTTP 路由 `/api/dsh-tree`（POST JSON），
 * 为浏览器半区提供对文件系统的只具名操作：列目录、系统打开、移到废纸篓、
 * 移动/重命名、新建、上传。永久插件（profile bundle）不经过动态 runner，
 * 因此不依赖 dynamic 半区的 `harness.handle`/`host.call`，而是走
 * 宿主 HTTP 路由 + 浏览器 `fetch` 的规范桥梁。
 *
 * 跨平台：move/create/upload 直接用 `node:fs/promises`（mac/linux/win 通用），
 * 仅 open/trash 这类"唤起系统"的动作按 `process.platform` 分支选命令。
 */

import { rename, mkdir, writeFile } from 'node:fs/promises'

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'ui-dsh-tree'

/** 注入的宿主服务。 */
export const inject = ['webServer', 'fs', 'subprocess', 'sandboxPolicy', 'sessions', 'timer']

/** 当前运行平台：'mac' | 'linux' | 'win'（其余回退 mac 逻辑）。 */
const PLATFORM = process.platform === 'win32' ? 'win'
  : process.platform === 'darwin' ? 'mac'
    : process.platform === 'linux' ? 'linux' : 'mac'

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
  const root = (ctx.sandboxPolicy && ctx.sandboxPolicy.workspaceRoot) || '/'

  // ------------------------------------------------------------------
  // 速度徽标：包 llm/stream 统计 token 吞吐（等待/流式/done 三态）
  // ------------------------------------------------------------------
  const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
  function estimateChars(text) {
    let cjk = 0
    let rest = 0
    for (const ch of text) { if (CJK.test(ch)) cjk++; else rest++ }
    return cjk + rest / 4
  }

  /** 会话级流状态：phase / token / tps / ttft。 */
  const streams = new Map()

  function extractKey(options) {
    try {
      if (!options) return null
      if (typeof options.sessionId === 'string') return options.sessionId
      if (options.session && typeof options.session.id === 'string') return options.session.id
      if (options.agent) {
        const a = options.agent
        if (typeof a.sessionId === 'string') return a.sessionId
        if (typeof a.id === 'string') return a.id
        if (a.session && typeof a.session.id === 'string') return a.session.id
      }
      if (options.meta && typeof options.meta.sessionId === 'string') return options.meta.sessionId
    } catch (err) { /* ignore */ }
    return null
  }

  function extractChunk(chunk) {
    let text = ''
    let realTokens = null
    try {
      if (!chunk) return { text, realTokens }
      if (typeof chunk.text === 'string') text += chunk.text
      if (typeof chunk.content === 'string') text += chunk.content
      if (Array.isArray(chunk.content)) {
        for (const part of chunk.content) if (part && typeof part.text === 'string') text += part.text
      }
      if (chunk.delta) {
        const d = chunk.delta
        if (typeof d.text === 'string') text += d.text
        if (typeof d.content === 'string') text += d.content
        if (d.usage) {
          const ot = d.usage.outputTokens != null ? d.usage.outputTokens
            : (d.usage.output_tokens != null ? d.usage.output_tokens
              : (d.usage.completion_tokens != null ? d.usage.completion_tokens : d.usage.completionTokens))
          if (typeof ot === 'number') realTokens = ot
        }
      }
      if (chunk.usage) {
        const u = chunk.usage
        const ot = u.outputTokens != null ? u.outputTokens
          : (u.output_tokens != null ? u.output_tokens
            : (u.completion_tokens != null ? u.completion_tokens : u.completionTokens))
        if (typeof ot === 'number') realTokens = ot
      }
      if (Array.isArray(chunk.choices)) {
        for (const c of chunk.choices) {
          const d = c && c.delta
          if (d && typeof d.content === 'string') text += d.content
          if (d && d.usage) {
            const ot = d.usage.outputTokens != null ? d.usage.outputTokens : d.usage.output_tokens
            if (typeof ot === 'number') realTokens = ot
          }
        }
      }
    } catch (err) { /* ignore */ }
    return { text, realTokens }
  }

  ctx.on('llm/stream', (options, next) => {
    const key = extractKey(options) || '_'
    const now = Date.now()
    streams.set(key, { phase: 'waiting', startedAt: now, firstChunkAt: null, charTokens: 0, realTokens: 0, hasReal: false, lastSeen: now })
    const innerP = Promise.resolve(next())
    return (async function* () {
      try {
        const inner = await innerP
        for await (const chunk of inner) {
          const st = streams.get(key)
          if (st) {
            const parsed = extractChunk(chunk)
            if (st.firstChunkAt === null) { st.firstChunkAt = Date.now(); st.phase = 'streaming' }
            if (parsed.text) st.charTokens += estimateChars(parsed.text)
            if (parsed.realTokens != null) { st.realTokens = parsed.realTokens; st.hasReal = true }
            st.lastSeen = Date.now()
          }
          yield chunk
        }
      } finally {
        const st = streams.get(key)
        if (st) {
          st.phase = 'done'
          st.lastSeen = Date.now()
        }
      }
    })()
  })

  const stopReap = ctx.timer.interval(() => {
    const now = Date.now()
    for (const [k, st] of streams) {
      if (st.phase === 'done' && now - st.lastSeen > 4000) streams.delete(k)
    }
  }, 1000)
  ctx.effect(stopReap, 'dsh-tree: speed stream reap')

  /** 返回当前会话的速度状态（无记录时回退到最近活跃流）。 */
  function speedStatus(sid) {
    let st = streams.get(sid)
    if (!st) {
      let latest = null
      for (const s of streams.values()) if (!latest || s.lastSeen > latest.lastSeen) latest = s
      st = latest
    }
    if (!st) return { phase: 'idle' }
    st.lastSeen = Date.now()
    const now = Date.now()
    const tokens = st.hasReal ? st.realTokens : Math.round(st.charTokens)
    let tps = 0
    if (st.phase === 'streaming' && st.firstChunkAt) {
      const elapsed = (now - st.firstChunkAt) / 1000
      if (elapsed > 0.5) tps = tokens / elapsed
    }
    return { phase: st.phase, tokens, tps, ttft: st.firstChunkAt ? st.firstChunkAt - st.startedAt : null }
  }

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

  /** 拼接目录与子项（统一正斜杠，兼容各平台）。 */
  function joinPath(dir, name) {
    return String(dir || '').replace(/[\\/]+$/, '') + '/' + name
  }

  /** 系统打开一个路径（按平台选命令）。 */
  async function openPath(path) {
    const p = String(path || '')
    if (!p) return { code: -1, error: '缺少路径' }
    if (PLATFORM === 'win') {
      // explorer /select 打开所在位置；单文件用 start 调默认程序
      return runCmd(['cmd', '/c', 'start', '', p])
    }
    if (PLATFORM === 'linux') {
      return runCmd(['xdg-open', p])
    }
    return runCmd(['/usr/bin/open', p])
  }

  /** 移到废纸篓（按平台选实现）。 */
  async function trashPath(path) {
    const p = String(path || '')
    if (!p) return { ok: false, error: '缺少路径' }
    if (PLATFORM === 'win') {
      // PowerShell Shell.Application 的 NameSpace(10) = 回收站
      const esc = String(p).replace(/'/g, "''")
      const script = `$sh = New-Object -ComObject Shell.Application; $sh.NameSpace(10).MoveHere('${esc}'); Start-Sleep -Milliseconds 300`
      const res = await runCmd(['powershell', '-NoProfile', '-Command', script])
      return res.code === 0
        ? { ok: true }
        : { ok: false, error: res.error || '移动失败', hint: '请确认 PowerShell 可用（Windows 10+ 自带）' }
    }
    if (PLATFORM === 'linux') {
      // 优先 gio trash（GNOME 自带），回退 trash-cli 的 trash 命令
      const res = await runCmd(['gio', 'trash', p])
      if (res.code === 0) return { ok: true }
      const res2 = await runCmd(['trash', p])
      if (res2.code === 0) return { ok: true }
      return { ok: false, error: (res.error || res2.error) || '移动失败', hint: '请安装 gio（glib2）或 trash-cli（如: sudo apt install trash-cli）' }
    }
    // mac: Finder osascript
    const esc = String(p).replace(/"/g, '\\"')
    const script = `tell application "Finder" to delete POSIX file "${esc}"`
    const res = await runCmd(['/usr/bin/osascript', '-e', script])
    return res.code === 0
      ? { ok: true }
      : { ok: false, error: res.error || '移动失败', hint: '如需移到废纸篓，请在 系统设置→隐私与安全性→自动化 中允许 DSH 控制 Finder' }
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
        const res = await openPath(args.path)
        return res.code === 0 ? { ok: true } : { ok: false, error: res.error || '打开失败' }
      }
      case 'trash': {
        return trashPath(args.path)
      }
      case 'move': {
        const from = String((args && args.from) || '')
        const to = String((args && args.to) || '')
        if (!from || !to) return { ok: false, error: '缺少路径' }
        try {
          await rename(from, to)
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
        const target = joinPath(dir, newName)
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
        if (!dir || !fileName) return { ok: false, error: '缺少参数' }
        const target = joinPath(dir, fileName)
        try {
          await writeFile(target, Buffer.from(data.replace(/\s+/g, ''), 'base64'))
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `写入失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'speed-status': {
        const sid = args && args.sessionId ? String(args.sessionId) : ''
        return { ok: true, ...speedStatus(sid) }
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
