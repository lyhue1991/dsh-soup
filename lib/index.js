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

import { rename, mkdir, writeFile, appendFile, open as openFile, stat, realpath } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'ui-dsh-soup'

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
  // 路径围栏：除 list 走沙箱 fs 外，其余具名文件操作（read/move/
  // trash/open/create/upload）一律先过 confine()，只允许落在
  // 「workspace 根 ∪ 所有已知会话 cwd」的子树内。解析走 realpath，
  // 防符号链接逃逸；容忍目标末级尚不存在（新建/上传/移动目标）。
  // 已知残留：confine 与实际操作之间存在 TOCTOU 窗口（符号链接竞态），
  // Node 可移植 API 下无法根除，见 README 安全模型。
  // ------------------------------------------------------------------
  /** win 文件系统大小写不敏感，比较时折叠大小写。 */
  const FOLD_CASE = PLATFORM === 'win'

  /** 带 HTTP 状态码的错误对象（handler 据此写响应码）。 */
  function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode })
  }

  /** 容忍末级不存在的 realpath：向上找最近一个已存在的祖先再拼回剩余段。 */
  async function realPathLenient(p) {
    let cur = path.resolve(String(p))
    const tail = []
    for (;;) {
      try {
        const rp = await realpath(cur)
        return tail.length ? path.join(rp, ...tail) : rp
      } catch (err) {
        const parent = path.dirname(cur)
        if (!err || err.code !== 'ENOENT' || parent === cur) throw err
        tail.unshift(path.basename(cur))
        cur = parent
      }
    }
  }

  let rootRealCache = null
  async function rootReal() {
    if (rootRealCache === null) {
      try { rootRealCache = await realpath(root) } catch { rootRealCache = path.resolve(root) }
    }
    return rootRealCache
  }

  /** candidate 是否位于 base 子树内（含 base 本身）。 */
  function within(base, candidate) {
    const b = FOLD_CASE ? base.toLowerCase() : base
    const c = FOLD_CASE ? candidate.toLowerCase() : candidate
    if (c === b) return true
    const rel = path.relative(b, c)
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)
  }

  /** 允许的基目录集合：workspace 根 + 所有已知会话的 cwd（尽力而为）。 */
  async function allowedBases(preferredSessionId) {
    const bases = [await rootReal()]
    const pushCwd = async (cwd) => {
      if (typeof cwd === 'string' && cwd) {
        try { bases.push(await realPathLenient(cwd)) } catch { /* 会话目录不可达则跳过 */ }
      }
    }
    // 指定会话优先直查：新会话刚创建时 list 枚举可能尚未纳入其 cwd。
    if (preferredSessionId && typeof sessions.get === 'function') {
      try {
        const pref = sessions.get(preferredSessionId)
        await pushCwd(pref && pref.header && pref.header.cwd)
      } catch { /* ignore */ }
    }
    try {
      const list = typeof sessions.list === 'function' ? sessions.list() : []
      for (const s of list) await pushCwd(s && s.header && s.header.cwd)
    } catch { /* 宿主无 list API 时仅用 workspace 根 */ }
    return bases
  }

  /**
   * 围栏校验：解析真实路径并确认落在允许基目录集合内。
   * 通过则返回规范化真实路径；越界/不可达抛带 statusCode 的错误。
   */
  async function confine(rawPath, label, preferredSessionId) {
    const name = label || '路径'
    const p = String(rawPath || '')
    if (!p) throw httpError(400, `缺少${name}`)
    let rp
    try {
      rp = await realPathLenient(p)
    } catch (err) {
      throw httpError(400, `${name}不可达: ${p}`)
    }
    for (const base of await allowedBases(preferredSessionId)) {
      if (within(base, rp)) return rp
    }
    throw httpError(403, `${name}超出允许范围（仅限工作区与会话目录）: ${p}`)
  }

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
    streams.set(key, { phase: 'waiting', startedAt: now, firstChunkAt: null, charTokens: 0, realTokens: 0, hasReal: false, lastChunkAt: null, lastContentAt: null, samples: [], lastSeen: now })
    const innerP = Promise.resolve(next())
    return (async function* () {
      try {
        const inner = await innerP
        for await (const chunk of inner) {
          const st = streams.get(key)
          if (st) {
            const parsed = extractChunk(chunk)
            const t = Date.now()
            if (st.firstChunkAt === null) { st.firstChunkAt = t; st.phase = 'streaming' }
            if (parsed.text) st.charTokens += estimateChars(parsed.text)
            if (parsed.realTokens != null) { st.realTokens = parsed.realTokens; st.hasReal = true }
            st.lastChunkAt = t
            // 只有携带真实内容的 chunk 才算「有进展」：keepalive / 空 delta
            // 不刷新内容时钟，避免等待期被空包滴漏伪装成慢速流式。
            if ((parsed.text && parsed.text.length > 0) || parsed.realTokens != null) st.lastContentAt = t
            // 滑动窗口采样：[时刻, 累计 token]，用于算瞬时速率而非全程平均
            st.samples.push([t, st.hasReal ? st.realTokens : st.charTokens])
            if (st.samples.length > 128) st.samples.splice(0, st.samples.length - 128)
            st.lastSeen = t
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
  ctx.effect(stopReap, 'dsh-soup: speed stream reap')

  /** 瞬时速率窗口 / 最小统计跨度 / 停顿判定阈值。 */
  const RATE_WINDOW_MS = 2000
  const RATE_MIN_SPAN_MS = 500
  const STALL_MS = 2000
  /** 真实生成下限：低于此速率必然是等待被误标（DeepSeek 正常输出远高于此）。 */
  const MIN_REAL_TPS = 3
  /** 速率分母宽限：内容停止后分母最多延伸这么久，静默期不稀释速率。 */
  const SPAN_GRACE_MS = 500

  /** 返回当前会话的速度状态（无记录时回退到最近活跃流）。 */
  function speedStatus(sid) {
    let st = streams.get(sid)
    if (!st) {
      let latest = null
      for (const s of streams.values()) if (!latest || s.lastSeen > latest.lastSeen) latest = s
      st = latest
    }
    if (!st) return { phase: 'idle' }
    const now = Date.now()
    const tokens = st.hasReal ? st.realTokens : Math.round(st.charTokens)
    const ttft = st.firstChunkAt ? st.firstChunkAt - st.startedAt : null
    if (st.phase !== 'streaming' || !st.firstChunkAt) {
      return { phase: st.phase, tokens, tps: 0, ttft }
    }
    // 停顿按「内容时钟」判定：keepalive / 空 delta 滴漏不算活动。
    const contentAt = st.lastContentAt || st.firstChunkAt
    const sinceContent = now - contentAt
    if (sinceContent > STALL_MS) {
      return { phase: 'waiting', tokens, tps: 0, ttft }
    }
    // 滑动窗口瞬时速率：基线优先取窗口前最后一个样本（burst 场景也能算出增量），
    // 否则取窗口内第一个样本。
    const cutoff = now - RATE_WINDOW_MS
    let base = null
    let first = null
    for (const s of st.samples) {
      if (first === null) first = s
      if (s[0] < cutoff) base = s
    }
    if (base === null) base = first
    let tps = 0
    if (base && now - base[0] >= RATE_MIN_SPAN_MS) {
      // 分母封顶到最后内容时刻 + 宽限：静默期不再把速率摊薄成 0.x t/s。
      const spanEnd = Math.min(now, contentAt + SPAN_GRACE_MS)
      if (spanEnd - base[0] >= RATE_MIN_SPAN_MS) {
        tps = Math.max(0, (tokens - base[1]) / ((spanEnd - base[0]) / 1000))
      }
    }
    // 近零进展护栏：内容已停顿超过最小跨度时，任何低于真实生成下限的读数
    // （含 0 与负增量截断）都判回等待——0.3 t/s 必然是等待，不是极慢生成。
    if (sinceContent >= RATE_MIN_SPAN_MS && tps < MIN_REAL_TPS) {
      return { phase: 'waiting', tokens, tps: 0, ttft }
    }
    return { phase: 'streaming', tokens, tps, ttft }
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
  async function openPath(path) {    const p = String(path || '')
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

  // ------------------------------------------------------------------
  // 文件只读预览：read（文本/图片/二进制三态）；无 write——预览-only 不提供保存
  // ------------------------------------------------------------------
  /** 文本读取上限（超过则截断标记 truncated）。8 MB——HTML 常含内联 base64 图片，2 MB 太紧。 */
  const TEXT_MAX_BYTES = 8 * 1024 * 1024
  /** 图片内联上限。 */
  const IMAGE_MAX_BYTES = 8 * 1024 * 1024
  /** PDF 内联上限。 */
  const PDF_MAX_BYTES = 20 * 1024 * 1024
  /** Notebook（.ipynb）文本上限——含图片输出的 base64，体积膨胀快，宽于普通文本。 */
  const NB_MAX_BYTES = 20 * 1024 * 1024
  /** 二进制嗅探窗口：头部出现 NUL 即判二进制。 */
  const BINARY_SNIFF = 8192
  /** 图片扩展名 → MIME。 */
  const IMAGE_MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  }
  function extOf(p) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(p || ''))
    return m ? m[1].toLowerCase() : ''
  }

  /**
   * 读取文件供 tab 展示：图片返回 base64，文本返回内容（可截断），
   * 二进制只返回元信息。统一走 node:fs/promises（跨平台、无 shell 注入面）。
   */
  async function readFileForView(path) {
    const p = String(path || '')
    if (!p) return { ok: false, error: '缺少路径' }
    let st
    try {
      st = await stat(p)
    } catch (err) {
      return { ok: false, error: `无法读取文件: ${String((err && err.message) || err)}` }
    }
    if (st.isDirectory()) return { ok: false, error: '目标是目录' }
    const ext = extOf(p)
    if (IMAGE_MIME[ext]) {
      if (st.size > IMAGE_MAX_BYTES) return { ok: true, kind: 'image-too-large', size: st.size, limit: IMAGE_MAX_BYTES }
      try {
        const fh = await openFile(p, 'r')
        try {
          const buf = Buffer.alloc(st.size)
          await fh.read(buf, 0, st.size, 0)
          return { ok: true, kind: 'image', mime: IMAGE_MIME[ext], data: buf.toString('base64'), size: st.size }
        } finally {
          await fh.close()
        }
      } catch (err) {
        return { ok: false, error: `无法读取文件: ${String((err && err.message) || err)}` }
      }
    }
    // PDF：整文件 base64 返回，交给浏览器原生查看器渲染（JupyterLab
    // pdf-extension 同思路：b64 → Blob → object 嵌入）。超限返回元信息。
    if (ext === 'pdf') {
      if (st.size > PDF_MAX_BYTES) return { ok: true, kind: 'pdf-too-large', size: st.size, limit: PDF_MAX_BYTES }
      try {
        const fh = await openFile(p, 'r')
        try {
          const buf = Buffer.alloc(st.size)
          await fh.read(buf, 0, st.size, 0)
          return { ok: true, kind: 'pdf', data: buf.toString('base64'), size: st.size }
        } finally {
          await fh.close()
        }
      } catch (err) {
        return { ok: false, error: `无法读取文件: ${String((err && err.message) || err)}` }
      }
    }
    // .ipynb 含图片输出的 base64，体积膨胀快——单独放宽文本上限
    const textCap = ext === 'ipynb' ? NB_MAX_BYTES : TEXT_MAX_BYTES
    const want = Math.min(st.size, textCap + 1)
    try {
      const fh = await openFile(p, 'r')
      let bytesRead
      let buf
      try {
        buf = Buffer.alloc(want)
        const r = await fh.read(buf, 0, want, 0)
        bytesRead = r.bytesRead
      } finally {
        await fh.close()
      }
      const sniffEnd = Math.min(bytesRead, BINARY_SNIFF)
      for (let i = 0; i < sniffEnd; i++) {
        if (buf[i] === 0) return { ok: true, kind: 'binary', size: st.size }
      }
      const truncated = st.size > textCap
      return { ok: true, kind: 'text', content: buf.toString('utf8', 0, Math.min(bytesRead, textCap)), size: st.size, truncated }
    } catch (err) {
      return { ok: false, error: `无法读取文件: ${String((err && err.message) || err)}` }
    }
  }

  // ------------------------------------------------------------------
  // 下载票据：POST 换取一次性短时效 URL，/dl 流式路由凭票发送。
  // 票据不可伪造 → GET 通道无需鉴权头也能保持与 POST 同级的门禁强度。
  // ------------------------------------------------------------------
  const downloadTickets = new Map()
  ctx.effect(
    () => ctx.timer.interval(() => {
      const now = Date.now()
      for (const [k, v] of downloadTickets) if (v.exp < now) downloadTickets.delete(k)
    }, 30000),
    'dsh-soup: download ticket sweep',
  )

  /** RFC 5987/6266 下载头：ASCII 兜底 + UTF-8 真名。 */
  function contentDisposition(name) {
    const fallback = name.replace(/[^\x20-\x7E]|["\\;\r\n]/g, '_') || 'download'
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
  }

  /** 流式下载路由：凭票单次发送，支持客户端中断即停读。 */
  async function dlHandler(req, res) {
    try {
      const token = new URL(req.url || '/?t=', 'http://local').searchParams.get('t') || ''
      const entry = downloadTickets.get(token)
      if (!entry) {
        writeJson(res, 404, { ok: false, error: '下载票据无效或已使用' })
        return
      }
      downloadTickets.delete(token)
      const st = await stat(entry.path)
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(st.size),
        'content-disposition': contentDisposition(entry.name),
        'cache-control': 'no-store',
      })
      const stream = createReadStream(entry.path)
      req.on('close', () => stream.destroy())
      stream.pipe(res)
    } catch (err) {
      if (!res.headersSent) writeJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      else res.end()
    }
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-soup/dl', handler: dlHandler }),
    'dsh-soup: streaming download route',
  )

  /**
   * 图片内联端点：GET /api/dsh-soup/img?p=<路径>。
   * 浏览器端 Markdown 预览会把「相对路径图片」改写为这里的绝对 URL，
   * 由 <img> 内联加载真实图片字节（JupyterLab md 图片同思路）。只读、无
   * Content-Disposition（内联显示而非下载）。
   * 安全模型：confine 围栏（只读工作区/会话目录）+ 仅图片类型 + 大小上限 +
   * 不返回任何 CORS 头 + 拒绝跨站（Sec-Fetch-Site: cross-site 与不同源 Origin）。
   * 注意 <img> 只能确认「是否 200/404」，无法读取像素，跨站利用面很小。
   */
  async function imageHandler(req, res) {
    try {
      const site = String(req.headers['sec-fetch-site'] || '')
      if (site === 'cross-site') {
        writeJson(res, 403, { ok: false, error: '跨站图片请求已拒绝' })
        return
      }
      const origin = req.headers.origin
      if (typeof origin === 'string' && origin !== '') {
        let originHost = ''
        try { originHost = new URL(origin).host } catch { originHost = '' }
        const host = typeof req.headers.host === 'string' ? req.headers.host : ''
        if (!originHost || originHost !== host) {
          writeJson(res, 403, { ok: false, error: '跨源图片请求已拒绝' })
          return
        }
      }
      let p = ''
      try { p = new URL(req.url || '/img?', 'http://local').searchParams.get('p') || '' } catch { p = '' }
      if (!p) { writeJson(res, 400, { ok: false, error: '缺少图片路径' }); return }
      const rp = await confine(p, '图片路径')
      const mime = IMAGE_MIME[extOf(rp)]
      if (!mime) { writeJson(res, 415, { ok: false, error: '不是可预览的图片类型' }); return }
      let st
      try { st = await stat(rp) } catch { writeJson(res, 404, { ok: false, error: '图片不可读' }); return }
      if (st.isDirectory() || st.size > IMAGE_MAX_BYTES) {
        writeJson(res, 413, { ok: false, error: '图片过大或目标为目录' }); return
      }
      const fh = await openFile(rp, 'r')
      let buf
      try {
        buf = Buffer.alloc(st.size)
        await fh.read(buf, 0, st.size, 0)
      } finally { await fh.close() }
      res.writeHead(200, {
        'content-type': mime,
        'content-length': String(st.size),
        'cache-control': 'no-store',
      })
      res.end(buf)
    } catch (err) {
      if (!res.headersSent) writeJson(res, (err && err.statusCode) || 500, { ok: false, error: String((err && err.message) || err) })
      else res.end()
    }
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-soup/img', handler: imageHandler }),
    'dsh-soup: inline image route',
  )

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
        // 分块上传（JupyterLab 同款语义）：chunk=1/缺省覆盖写，chunk>=2 追加。
        // 无需服务端状态——按块序到达即顺序落盘。
        const chunk = Number((args && args.chunk) || 0)
        if (chunk < 0 || !Number.isInteger(chunk)) return { ok: false, error: '无效的 chunk 序号' }
        try {
          const bytes = Buffer.from(data.replace(/\s+/g, ''), 'base64')
          if (chunk >= 2) await appendFile(target, bytes)
          else await writeFile(target, bytes)
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `写入失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'read': {
        const rp = await confine(args.path, '文件路径', sessionIdArg)
        return readFileForView(rp)
      }
      case 'download': {
        // 流式下载签发：围栏校验通过后发一张一次性、2 分钟时效的票据 URL，
        // 真正的字节由 /api/dsh-soup/dl 流式发送——任意大小文件零内存放大。
        const rp = await confine(args.path, '下载路径', sessionIdArg)
        let dst
        try {
          dst = await stat(rp)
        } catch (err) {
          return { ok: false, error: '无法读取文件' }
        }
        if (dst.isDirectory()) return { ok: false, error: '目标是目录，不支持下载' }
        const token = randomBytes(24).toString('hex')
        downloadTickets.set(token, { path: rp, name: path.basename(rp), exp: Date.now() + 120000 })
        return { ok: true, name: path.basename(rp), size: dst.size, url: `/api/dsh-soup/dl?t=${token}` }
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
        return { ok: true, ...speedStatus(sid) }
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
