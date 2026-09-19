import { injectPluginStyles, ICON_REFRESH, ICON_NEW_FOLDER, ICON_MORE, FILE_ICON_EDIT, FILE_ICON_PREVIEW, EXPAND_SVG, SHRINK_SVG } from './client/styles.js'
import { NS, DICT } from './client/i18n.js'
import { iconSvgFor, CODE_LANG_BY_EXT } from './client/file-icons.js'
/**
 * dsh-soup — 浏览器半区：项目资源管理器。
 *
 * 布局：注册进 shell 原生的 `details` 右列（并列网格，非悬浮），
 * 有 Session log 时在它右侧放 📁；空白新会话则在输入框上方、
 * workspace/preset 控件行的右端提供同一入口。
 * 宽度对齐宿主 details 合同：默认 360px、可拖 300–520px（直接改写 shell 网格
 * 的 details 轨，并用 MutationObserver 在 shell 重渲染后维持宽度）。
 *
 * 与宿主通信：走同源 HTTP 路由 `/api/dsh-soup`（POST JSON），
 * 即永久插件（profile bundle）规范桥梁，而非 dynamic 半区的 host.call。
 * 文件「预览」按类型渲染；常见文本文件可编辑并用 mtime/size 防覆盖保存。
 */
window.__ModuleLoader__.load({
  id: '@lyhue1991/dsh-soup',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var create = React.createElement

    // CodeMirror 6 follows the same single-editor model used by JupyterLab:
    // text, syntax decorations, cursor, gutter and scrolling share one view.
    var CMEditorView = null
    var CMEditorState = null
    var CMKeymap = null
    var CMCommands = null
    var CMLanguage = null
    var CMHighlightTags = null
    var CMLangs = {}
    try {
      CMEditorView = require('@codemirror/view')
      CMEditorState = require('@codemirror/state')
      CMKeymap = require('@codemirror/view')
      CMCommands = require('@codemirror/commands')
      CMLanguage = require('@codemirror/language')
      CMHighlightTags = require('@lezer/highlight').tags
      CMLangs.css = require('@codemirror/lang-css')
      CMLangs.html = require('@codemirror/lang-html')
      CMLangs.javascript = require('@codemirror/lang-javascript')
      CMLangs.json = require('@codemirror/lang-json')
      CMLangs.markdown = require('@codemirror/lang-markdown')
      CMLangs.python = require('@codemirror/lang-python')
      CMLangs.sql = require('@codemirror/lang-sql')
      CMLangs.xml = require('@codemirror/lang-xml')
    } catch (err) {
      CMEditorView = null
      CMEditorState = null
      CMKeymap = null
      CMCommands = null
      CMLanguage = null
      CMHighlightTags = null
      CMLangs = {}
    }

    // 可选依赖：DSH 自带的不可信 Markdown 渲染器（micromark 管线，与聊天
    // 消息同款；不安全协议与相对链接被禁用）与 Shiki 代码高亮块（CodeBlock，
    // 懒加载语法包 + 复制按钮）。旧版宿主缺该模块时回退纯文本预览。
    // 注意：export 是 React.memo() 的产物——是 exotic 组件对象而非 function，
    // 判断只能验真值，不能 typeof==='function'。
    var MarkdownText = null
    var CodeBlock = null
    try {
      var uiPrim = require('@deepseek-ai/dsh-client-ui-primitives')
      var cand = uiPrim && uiPrim.MarkdownText
      if (cand) MarkdownText = cand
      else {
        try { window.__DSH_TREE_REQ_ERR = 'seed missing MarkdownText; type=' + typeof cand } catch (_) {}
      }
      var candBlock = uiPrim && uiPrim.CodeBlock
      if (candBlock) CodeBlock = candBlock
    } catch (err) {
      try { window.__DSH_TREE_REQ_ERR = 'require threw: ' + String((err && err.message) || err) } catch (_) {}
    }

    // 样式与图标实现在 client/styles.js（含幂等注入）。
    injectPluginStyles()

    /** 需要的客户端服务：slots、layout、timer、sessions、locale（i18n 词典）+ remote.goals（goal 动作动词）。 */
    // 注意：sidebarRight 不能进 inject——DSH Desktop (0.1.5-rc.2) 宿主里该服务
    // 永远不就绪，可选注入也会让插件一直 pending（"waiting for service"），
    // 被 desktop 判为阻挡启动。桥接改为运行时轮询解析（见 resolveSidebarRight）。
    var inject = ['slots', 'layout', 'timer', 'sessions', 'locale', 'remote', 'remote.goals']

    // i18n 词典与命名空间在 client/i18n.js（export NS / DICT）。
    var T = function (key, params) { return key }


    // ------------------------------------------------------------------
    // 状态存储（模块级，供 Panel 与 HeaderAction 共享）
    // ------------------------------------------------------------------
    var state = {
      open: false, cwd: '', tree: [], menu: null, error: '', notice: '',
      selected: new Set(), lastIndex: null,
      renaming: null, newItem: null,
      dropTarget: null, dragPaths: null,
      files: { list: [], active: null, overlay: false, overlayMax: false, overlayReturn: null },
      uploads: [],
      uploadConflict: null,
    }
    var listeners = new Set()
    // trackSession() is called by both the hero toggle and the details panel
    // while a blank conversation is mounted. Keep late async responses from an
    // older caller from overwriting the current session's shared store.
    var sessionTrackGeneration = 0
    var autoSaveTimers = new Map()
    var autoSaveSavedTimers = new Map()
    var manualSavePaths = new Set()
    var AUTO_SAVE_DELAY_MS = 5000
    var SAVED_INDICATOR_MS = 1500

    // 目录展开状态按 cwd 隔离。刷新/删除/改名/移动后先重拉根目录，
    // 再按这些路径递归重拉仍存在的已展开目录；切换项目时才清空。
    var expandedDirs = new Set()
    var expandedDirsCwd = null

    function forgetExpandedPaths(paths) {
      var dropped = paths.map(function (p) { return [p, p + '/'] })
      expandedDirs = new Set(Array.from(expandedDirs).filter(function (p) {
        return !dropped.some(function (pair) { return p === pair[0] || p.startsWith(pair[1]) })
      }))
    }

    function rekeyExpandedPaths(from, to) {
      var moved = Array.from(expandedDirs).filter(function (p) {
        return p === from || p.startsWith(from + '/')
      }).sort(function (a, b) { return a.length - b.length })
      if (!moved.length) return
      var next = new Set(Array.from(expandedDirs).filter(function (p) {
        return p !== from && !p.startsWith(from + '/')
      }))
      moved.forEach(function (p) { next.add(to + p.slice(from.length)) })
      expandedDirs = next
    }

    function setState(patch) {
      state = Object.assign({}, state, patch)
      listeners.forEach(function (fn) { fn() })
    }
    function subscribe(fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    }
    function useStore() {
      var force = React.useReducer(function (x) { return x + 1 }, 0)[1]
      React.useEffect(function () { return subscribe(function () { force() }) }, [])
      return state
    }

    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（共享数据层）
    //   共享 store、/api/dsh-soup RPC、树数据加载/自动刷新、selection、拖拽/上传/下载、类型图标 —— 预览亦复用其中 store/rpc。
    // ------------------------------------------------------------------
    var visibleRows = []
    var uploadInputEl = null
    var layout = null

    var DETAILS_MIN = 300
    var DETAILS_MAX = 520
    var DETAILS_DEFAULT = 360
    function clampW(w) { return Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, w)) }

    function pathJoin(dir, name) { return String(dir || '/').replace(/\/+$/, '') + '/' + name }
    function parentOf(path) {
      var p = String(path || '/').replace(/\/+$/, '')
      var i = p.lastIndexOf('/')
      return i <= 0 ? '/' : p.slice(0, i)
    }
    function baseName(path) {
      var p = String(path || '').replace(/\/+$/, '')
      var i = p.lastIndexOf('/')
      return i < 0 ? p : p.slice(i + 1)
    }

    // ------------------------------------------------------------------
    // 与宿主通信：POST /api/dsh-soup
    // ------------------------------------------------------------------
    function hostBase() {
      var origin = globalThis.location && globalThis.location.origin
      return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
    }
    function rpc(action, args) {
      return fetch(new URL('/api/dsh-soup', hostBase()), {
        method: 'POST',
        // x-dsh-soup：宿主路由的强制头（防跨站简单请求伪造），
        // content-type 必须 application/json，两者缺一会被 403。
        headers: { 'content-type': 'application/json', 'x-dsh-soup': '1' },
        body: JSON.stringify({ action: action, args: args || {} }),
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: T('explorer.hostBadResponse') } })
      }).catch(function (err) {
        return { ok: false, error: T('explorer.hostUnreachable', { reason: String((err && err.message) || err) }) }
      })
    }

    async function loadDir(path, attempt) {
      var res = await rpc('list', { path: path, sessionId: activeSessionId })
      // 新会话刚切换时，宿主会话注册表可能尚未纳入其 cwd——稍候重试。
      if ((!res || !res.ok) && /超出允许范围/.test((res && res.error) || '') && (attempt || 0) < 3) {
        await new Promise(function (r) { setTimeout(r, 600) })
        return loadDir(path, (attempt || 0) + 1)
      }
      if (!res || !res.ok) {
        setState({ error: (res && res.error) || T('explorer.readFail') })
        return null
      }
      return res.entries || []
    }

    async function defaultCwd(sessionId, hint) {
      // 以会话工作目录为准：优先用客户端会话快照里的 cwd（与官方细节栏同源，
      // 始终指向"当前会话所在项目"），其次查宿主会话 header。
      if (hint) return hint
      if (sessionId) {
        var res = await rpc('sessionCwd', { sessionId: sessionId })
        if (res && res.ok && res.cwd) return res.cwd
      }
      // 已知会话但尚未拿到 cwd 时不要猜路径：猜测 '/' 正好会撞上桌面端
      // 工作区围栏（Desktop 主进程通常从用户主目录启动）。等 useSessions
      // 补上 cwd 后 effect 会重跑。
      if (sessionId) return undefined
      // 无当前会话（例如启动时右栏先挂载）回退到宿主 root；它一定在围栏内，
      // 而文件系统根 '/' 不一定在。
      var rootRes = await rpc('root')
      if (rootRes && rootRes.ok && rootRes.root) return rootRes.root
      return undefined
    }

    async function trackSession(sessionId, cwdHint) {
      var generation = ++sessionTrackGeneration
      activeSessionId = sessionId || null
      var cwd = await defaultCwd(sessionId, cwdHint)
      if (generation !== sessionTrackGeneration) return
      if (!cwd) {
        setState({ cwd: '', tree: [], selected: new Set(), renaming: null, newItem: null, menu: null, error: '', notice: '', files: [] })
        return
      }
      // 换项目时展开状态没有跨项目意义；回到同一项目则保留。
      if (expandedDirsCwd !== cwd) {
        expandedDirs.clear()
        expandedDirsCwd = cwd
      }
      // 会话切换：预览列表按新 cwd 裁剪（范围外自动关闭），并清掉上一路径的旧错误横幅
      var files = pruneFilesToScope(state.files, cwd)
      lastMtimes = {} // 换了目录，旧 mtime 基线全部作废（首轮 tick 重建基线）
      setState({ cwd: cwd, selected: new Set(), renaming: null, newItem: null, menu: null, error: '', notice: '', files: files })
      var items = await loadDir(cwd)
      if (generation !== sessionTrackGeneration) return
      if (items) setState({ error: '', tree: items })
    }

    async function refresh() {
      if (!state.cwd) return
      var items = await loadDir(state.cwd)
      if (!items) return
      await restoreExpandedChildren(items)
      setState({ error: '', tree: items })
    }

    /** 根目录刷新后，按记住的路径递归恢复已展开目录。 */
    async function restoreExpandedChildren(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (node.type !== 'directory' || !expandedDirs.has(node.path)) continue
        var items = await loadDir(node.path)
        if (!items) {
          expandedDirs.delete(node.path)
          continue
        }
        node.open = true
        node.children = items
        items.forEach(function (child) { child.parent = node })
        await restoreExpandedChildren(items)
      }
    }

    // ------------------------------------------------------------------
    // 自动刷新：低频轮询宿主 mtime 探测（3s 一次），签名变了才真正重拉。
    // watch 范围 = 当前 cwd + 已展开目录 + 打开的预览文件；面板关闭且无
    // 预览时整个 tick 直接返回（零请求）。不做文件 watcher——fs.watch
    // 递归语义跨平台不一致且大工作区开销高，stat 几个路径便宜得多。
    // ------------------------------------------------------------------
    var AUTO_REFRESH_MS = 3000
    var AUTO_WATCH_MAX = 64
    var lastMtimes = {}   // path -> {m,s,d}|null；undefined = 尚无基线（首轮只建基线不触发）
    var autoTicking = false

    function collectWatchPaths() {
      var paths = []
      if (state.cwd) paths.push(state.cwd)
      var walk = function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i]
          if (n.type === 'directory' && n.children != null) {
            paths.push(n.path)
            if (n.open && n.children.length) walk(n.children)
          }
        }
      }
      walk(state.tree)
      for (var j = 0; j < state.files.list.length; j++) {
        var e = state.files.list[j]
        if (e.path && paths.indexOf(e.path) < 0) paths.push(e.path)
      }
      return paths.slice(0, AUTO_WATCH_MAX)
    }

    /** 预览文件在磁盘上变了：静默重读该 entry（不动激活状态、不闪 tab）。 */
    async function silentReloadEntry(entry) {
      var res = await rpc('read', { path: entry.path, sessionId: activeSessionId })
      if (!res || !res.ok) return
      entry.kind = res.kind
      entry.size = res.size || 0
      if (res.kind === 'text') {
        entry.truncated = !!res.truncated
          if (!entry.dirty && !entry.editing) {
          entry.content = res.content
          entry.baseContent = res.content
          entry.draft = res.content
          entry.baseMtime = res.mtime
          entry.baseSize = res.size
        } else {
          entry.conflict = true
          entry.diskMtime = res.mtime
          entry.diskSize = res.size
          scheduleAutoSave(entry.path)
        }
      }
      else if (res.kind === 'image') { entry.dataUrl = 'data:' + res.mime + ';base64,' + res.data }
      else if (res.kind === 'pdf') { entry.data = res.data }
      setFiles({ list: state.files.list.slice() })
    }

    /** 已展开目录的子项变了：重拉该目录（保持展开态）。 */
    async function reloadDirNode(node) {
      var items = await loadDir(node.path)
      if (items) items.forEach(function (c) { c.parent = node })
      node.children = items || []
      node.open = true
      setState({ tree: state.tree })
    }

    /**
     * 探一轮。返回 'idle'（本轮没发请求）/ true（探测成功）/ false（请求失败）。
     * 只有真正发出去且失败的请求才累积退避；空闲不累积——面板重开时本就有
     * 一次全量 loadDir，无需为"关着的时候宿主是否恢复"操心。
     */
    async function autoRefreshTick() {
      if (autoTicking) return 'idle'
      if (!state.open && state.files.list.length === 0) return 'idle'
      // 用户正在操作（重命名/新建/右键菜单）时跳过本轮，避免打断输入
      if (state.renaming || state.newItem || state.menu) return 'idle'
      var paths = collectWatchPaths()
      if (!paths.length) return 'idle'
      autoTicking = true
      try {
        var res = await rpc('mtime', { paths: paths })
        if (!res || !res.ok) return false
        var mtimes = res.mtimes || {}
        var dirtyDirs = []
        var dirtyFiles = []
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i]
          var now = Object.prototype.hasOwnProperty.call(mtimes, p) ? mtimes[p] : null
          var prev = Object.prototype.hasOwnProperty.call(lastMtimes, p) ? lastMtimes[p] : undefined
          lastMtimes[p] = now
          if (prev === undefined || prev === null || now === null) continue
          if (now.m === prev.m && now.s === prev.s) continue
          if (now.d) dirtyDirs.push(p)
          else dirtyFiles.push(p)
        }
        for (var d = 0; d < dirtyDirs.length; d++) {
          var dp = dirtyDirs[d]
          if (dp === state.cwd) { await refresh(); continue }
          var node = findNode(state.tree, dp)
          if (node && node.children != null) await reloadDirNode(node)
        }
        for (var f = 0; f < dirtyFiles.length; f++) {
          var entry = findFileEntry(dirtyFiles[f])
          if (!entry || !entry.loaded) continue
          var currentSignature = mtimes[dirtyFiles[f]]
          if (currentSignature
            && currentSignature.m === entry.baseMtime
            && currentSignature.s === entry.baseSize) continue
          await silentReloadEntry(entry)
        }
        return true
      } finally {
        autoTicking = false
      }
    }

    // 失败退避：宿主不可达（DSH 重启中 / 插件重载 / 断连）时别每 3s 硬打——
    // 指数退避 3s→6s→12s→24s→48s，封顶 60s；一旦成功回到 3s。
    // （JupyterLab FileBrowserModel 的 Poll 同思路：backoff + max 封顶。）
    // 实现：1s 固定心跳 + 「到期才探测」，而不是变间隔定时器——宿主提供的
    // timer 服务可 dispose，测试环境（interval 为 no-op mock）也不会挂住进程。
    var AUTO_HEARTBEAT_MS = 1000
    var AUTO_BACKOFF_MAX_MS = 60000
    var autoFailCount = 0
    var autoLastProbeAt = 0

    function autoDelayMs() {
      if (autoFailCount <= 0) return AUTO_REFRESH_MS
      return Math.min(AUTO_REFRESH_MS * Math.pow(2, autoFailCount), AUTO_BACKOFF_MAX_MS)
    }

    function autoHeartbeat() {
      var now = Date.now()
      if (now - autoLastProbeAt < autoDelayMs()) return
      autoLastProbeAt = now
      autoRefreshTick().then(function (outcome) {
        if (outcome === false) autoFailCount++
        else autoFailCount = 0
      })
    }

    /** 手动刷新：重拉根目录，已展开的子目录逐个重拉、保持展开不收起。 */
    async function refreshAll() {
      if (!state.cwd) return
      await refresh()
    }

    async function toggleNode(node) {
      if (node.type !== 'directory') return
      if (node.children == null) {
        node.loading = true
        setState({ tree: state.tree })
        var items = await loadDir(node.path)
        node.loading = false
        if (items) items.forEach(function (c) { c.parent = node })
        node.children = items || []
        node.open = !!items
        if (items) expandedDirs.add(node.path)
        // 拖拽可能把一个已展开目录移进此前收起的父目录。父目录首次展开时，
        // 也要立即恢复其中被记住的子目录展开状态。
        if (items) await restoreExpandedChildren(items)
        setState({ tree: state.tree })
      } else {
        node.open = !node.open
        if (node.open) expandedDirs.add(node.path)
        else expandedDirs.delete(node.path)
        setState({ tree: state.tree })
      }
    }

    function formatSize(n) {
      if (typeof n !== 'number' || n < 0) return ''
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(1) + ' GB'
    }


    function findNode(nodes, path) {
      if (!Array.isArray(nodes)) return null
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        if (n.path === path) return n
        if (Array.isArray(n.children) && n.children.length) {
          var r = findNode(n.children, path)
          if (r) return r
        }
      }
      return null
    }

    function rowIndex(path) {
      for (var i = 0; i < visibleRows.length; i++) if (visibleRows[i] === path) return i
      return -1
    }

    function onRowClick(e, node) {
      e.stopPropagation()
      var path = node.path
      var meta = e.metaKey || e.ctrlKey
      var shift = e.shiftKey
      var sel = new Set(state.selected)
      var lastIndex = state.lastIndex
      if (shift && lastIndex != null) {
        var idx = rowIndex(path)
        var from = Math.min(lastIndex, idx)
        var to = Math.max(lastIndex, idx)
        for (var i = from; i <= to; i++) { if (visibleRows[i]) sel.add(visibleRows[i]) }
      } else if (meta) {
        if (sel.has(path)) sel.delete(path); else sel.add(path)
        lastIndex = rowIndex(path)
      } else {
        sel.clear(); sel.add(path); lastIndex = rowIndex(path)
      }
      setState({ selected: sel, lastIndex: lastIndex })
    }

    function onRowDoubleClick(node) {
      if (node.type === 'directory') {
        toggleNode(node)
      } else {
        openFileInTab(node.path)
      }
    }

    function onRowContext(e, node) {
      e.preventDefault()
      e.stopPropagation()
      var sel = new Set(state.selected)
      if (!sel.has(node.path)) { sel.clear(); sel.add(node.path); setState({ selected: sel }) }
      setState({ menu: { x: e.clientX, y: e.clientY, node: node } })
    }

    function onBlankContext(e) {
      e.preventDefault()
      e.stopPropagation()
      setState({ selected: new Set(), lastIndex: null, menu: { x: e.clientX, y: e.clientY, node: null } })
    }

    function onBlankClick(e) {
      if (e.target && e.target.closest && e.target.closest('[data-path]')) return
      setState({ selected: new Set(), lastIndex: null })
    }

    function onRowMore(e, node) {
      e.preventDefault()
      e.stopPropagation()
      var sel = new Set(state.selected)
      sel.clear()
      sel.add(node.path)
      var rect = e.currentTarget.getBoundingClientRect()
      setState({ selected: sel, lastIndex: null, menu: { x: rect.right - 4, y: rect.bottom + 4, node: node } })
    }

    async function openSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      for (var i = 0; i < paths.length; i++) await rpc('open', { path: paths[i] })
    }

    async function trashSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      var errors = []
      var trashed = []
      for (var i = 0; i < paths.length; i++) {
        var res = await rpc('trash', { path: paths[i] })
        if (res && res.ok) trashed.push(paths[i])
        else errors.push(baseName(paths[i]) + ': ' + ((res && res.error) || T('explorer.actionFail')) + ((res && res.hint) ? '（' + res.hint + '）' : ''))
      }
      if (errors.length) setState({ error: errors.join('；') })
      forgetExpandedPaths(trashed)
      setState({ selected: new Set(), lastIndex: null })
      await refresh()
    }

    function startRename(node) { setState({ renaming: node.path, menu: null }) }

    function commitRename(path, name) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        setState({ renaming: null })
        return
      }
      var dir = parentOf(path)
      var dest = pathJoin(dir, name)
      var node = findNode(state.tree, path)
      var isDir = node && node.type === 'directory'
      var sel = new Set(state.selected)
      if (sel.has(path)) { sel.delete(path); sel.add(dest) }
      setState({ renaming: null, selected: sel })
      ;(async function () {
        var res = await rpc('move', { from: path, to: dest })
        if (res && res.ok) {
          if (isDir) rekeyExpandedPaths(path, dest)
        } else {
          setState({ error: (res && res.error) || T('explorer.renameFail') })
        }
        await refresh()
      })()
    }

    function startNew(parent, isDir) {
      setState({ newItem: { parent: parent, isDir: isDir }, menu: null })
      if (parent !== state.cwd) {
        var parentNode = findNode(state.tree, parent)
        if (parentNode && parentNode.children == null) toggleNode(parentNode)
      }
    }

    function commitNew(parent, name, isDir) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        setState({ newItem: null })
        return
      }
      setState({ newItem: null })
      ;(async function () {
        var res = await rpc('create', { dir: parent, name: name, isDir: isDir })
        if (!res || !res.ok) setState({ error: (res && res.error) || T('explorer.createFail') })
        await refresh()
      })()
    }

    /** 成功通知：3 秒后自动消失（仅当未被更新的消息覆盖时才清除）。 */
    var noticeTimer = null
    function showNotice(text) {
      setState({ notice: text, error: '' })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(function () {
        if (state.notice === text) setState({ notice: '' })
      }, 3000)
    }

    function copyPath(target) {
      var p = target && target.path ? target.path : state.cwd
      setState({ menu: null })
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () { showNotice(T('explorer.renamed')) }).catch(function () {})
        }
      } catch (err) {}
    }

    function onDragStart(e, node) {
      var paths = state.selected.has(node.path) ? Array.from(state.selected) : [node.path]
      setState({ dragPaths: paths })
      try { e.dataTransfer.setData('text/plain', paths.join('\n')) } catch (err) {}
      e.dataTransfer.effectAllowed = 'move'
    }

    function doDrop(e, targetDir) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(targetDir, Array.from(e.dataTransfer.files))
        return
      }
      movePaths(state.dragPaths || [], targetDir)
    }

    function onRowDrop(e, node) {
      e.preventDefault()
      e.stopPropagation()
      if (node.type !== 'directory') return
      doDrop(e, node.path)
      setState({ dropTarget: null })
    }

    function onBodyDrop(e) {
      e.preventDefault()
      doDrop(e, state.cwd)
      setState({ dropTarget: null })
    }

    async function movePaths(paths, targetDir) {
      var errors = []
      var moved = []
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i]
        if (p === '/' || !p) continue
        var name = baseName(p)
        var dest = pathJoin(targetDir, name)
        if (dest === p) continue
        if (targetDir === p || targetDir.startsWith(p + '/')) { errors.push(T('explorer.moveIntoSelf', { path: name })); continue }
        var node = findNode(state.tree, p)
        var res = await rpc('move', { from: p, to: dest })
        if (res && res.ok) {
          moved.push({ from: p, to: dest, isDir: node && node.type === 'directory' })
        } else {
          errors.push(name + ': ' + ((res && res.error) || T('explorer.actionFail')))
        }
      }
      setState({ dragPaths: null })
      moved.forEach(function (item) {
        if (item.isDir) rekeyExpandedPaths(item.from, item.to)
      })
      if (errors.length) setState({ error: errors.join('；') })
      await refresh()
    }

    function fileToBase64(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader()
        r.onload = function () { var s = String(r.result || ''); var i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s) }
        r.onerror = function () { reject(new Error(T('files.readFail'))) }
        r.readAsDataURL(file)
      })
    }

    /** 单块大小：超过则走分块通道（JupyterLab 同款 1MB）。 */
    var UPLOAD_CHUNK_SIZE = 1024 * 1024

    function setUploadEntry(entry) {
      var list = (state.uploads || []).slice()
      var found = false
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === entry.name) { list[i] = entry; found = true; break }
      }
      if (!found) list.push(entry)
      setState({ uploads: list })
    }

    function updateUpload(name, loaded, total, idx, totalFiles, down) {
      setUploadEntry({ name: name, loaded: loaded, total: total, idx: idx, totalFiles: totalFiles, done: false, down: !!down })
    }

    function finishUploads(count, okCount, failedName, down) {
      // These translations own the `{n}` placeholder; passing no params leaves
      // the literal token visible in the green completion notice.
      var verb = down ? T('explorer.downloaded', { n: okCount }) : T('explorer.uploaded', { n: okCount })
      var suffix = okCount === count ? '' : ' · ' + T('explorer.filesCountPartial', { ok: okCount, total: count })
      setUploadEntry({
        name: '✓ ' + verb + suffix + (failedName ? '（' + failedName + '）' : ''),
        loaded: 0, total: 0, idx: 0, totalFiles: 0, done: true, down: !!down,
      })
      window.setTimeout(function () { setState({ uploads: [] }) }, 1600)
    }

    /** 单文件分块上传：>1MB 切片逐块 POST，首块覆盖、后续追加。 */
    async function uploadOneFile(dir, f, idx, totalFiles) {
      var chunked = f.size > UPLOAD_CHUNK_SIZE
      var chunks = Math.max(1, Math.ceil(f.size / UPLOAD_CHUNK_SIZE))
      updateUpload(f.name, 0, f.size, idx, totalFiles)
      for (var c = 0; c < chunks; c++) {
        var start = c * UPLOAD_CHUNK_SIZE
        var blob = f.slice(start, Math.min(f.size, start + UPLOAD_CHUNK_SIZE))
        var b64 = await fileToBase64(blob)
        var args = {
          dir: dir, name: f.name, data: b64,
          chunk: chunked ? c + 1 : undefined,
        }
        var res = await rpc('upload', args)
        if (res && res.conflict) {
          var overwrite = await askOverwrite(f.name)
          if (!overwrite) throw new Error('已取消上传')
          args.overwrite = true
          res = await rpc('upload', args)
        }
        if (!res || !res.ok) throw new Error((res && res.error) || T('explorer.uploadFail'))
        updateUpload(f.name, Math.min(f.size, start + UPLOAD_CHUNK_SIZE), f.size, idx, totalFiles)
      }
    }

    async function uploadFiles(dir, files) {
      if (!files || !files.length) return
      var errors = []
      var okCount = 0
      for (var i = 0; i < files.length; i++) {
        var f = files[i]
        try {
          await uploadOneFile(dir, f, i + 1, files.length)
          okCount++
        } catch (err) {
          errors.push(f.name + ': ' + String((err && err.message) || err))
        }
      }
      finishUploads(files.length, okCount, errors.length ? errors[0].split(':')[0] : '')
      if (errors.length) setState({ error: errors.join('；'), notice: '' })
      await refresh()
    }

    /** ≤100MB 走页面内 fetch + 进度行 + Blob 另存；>100MB 走浏览器原生下载。 */
    var DOWNLOAD_PROGRESS_LIMIT = 100 * 1024 * 1024

    async function downloadFile(path) {
      setState({ menu: null })
      var res = await rpc('download', { path: path, sessionId: activeSessionId })
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 600) })
        res = await rpc('download', { path: path, sessionId: activeSessionId })
      }
      if (!res || !res.ok) {
        setState({ error: (res && res.error) || T('explorer.downloadFail') })
        return
      }
      var name = res.name || baseName(path)
      var size = res.size || 0
      // 大文件：浏览器原生下载（流式落盘、零内存），无进度
      if (size > DOWNLOAD_PROGRESS_LIMIT) {
        var a = document.createElement('a')
        a.href = res.url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        showNotice(T('explorer.downloadStart', { name: name }))
        return
      }
      // 中小文件：fetch 流式读字节计进度，完成后 Blob 另存（峰值≈文件体积）
      updateUpload(name, 0, size, 0, 1, true)
      try {
        var r = await fetch(res.url)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        var total = Number(r.headers.get('content-length')) || size
        var reader = r.body.getReader()
        var received = 0
        var chunks = []
        for (;;) {
          var part = await reader.read()
          if (part.done) break
          chunks.push(part.value)
          received += part.value.length
          updateUpload(name, received, total, 0, 1, true)
        }
        var blobUrl = URL.createObjectURL(new Blob(chunks))
        var da = document.createElement('a')
        da.href = blobUrl
        da.download = name
        document.body.appendChild(da)
        da.click()
        da.remove()
        window.setTimeout(function () { URL.revokeObjectURL(blobUrl) }, 5000)
        finishUploads(1, 1, '', true)
      } catch (err) {
        setState({ error: T('explorer.downloadFailWith', { reason: String((err && err.message) || err) }), uploads: [] })
      }
    }

    function onUploadPicker(e) {
      var files = Array.from((e.target && e.target.files) || [])
      uploadFiles(state.cwd, files)
      e.target.value = ''
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（列表 UI）
    //   NameInput / Row / buildMenuItems / Menu：行渲染、多选、右键菜单、重命名/新建。
    // ------------------------------------------------------------------
    function NameInput(props) {
      var initial = props.initial
      var selectBase = props.selectBase !== false
      var onCommit = props.onCommit
      var onCancel = props.onCancel
      var valState = React.useState(initial)
      var val = valState[0]
      var setVal = valState[1]
      var settled = React.useRef(false)
      var inputRef = React.useRef(null)
      React.useEffect(function () {
        var el = inputRef.current
        if (!el) return
        el.focus()
        if (selectBase) {
          var dot = initial.lastIndexOf('.')
          if (dot <= 0) el.select(); else el.setSelectionRange(0, dot)
        } else {
          el.select()
        }
      }, [])
      function settle(fn) { if (settled.current) return; settled.current = true; fn() }
      return create('input', {
        ref: inputRef,
        type: 'text',
        value: val,
        spellCheck: false,
        autoComplete: 'off',
        className: 'expl-inline-input',
        onChange: function (e) { setVal(e.target.value) },
        onClick: function (e) { e.stopPropagation() },
        onBlur: function () { settle(function () { onCommit(val) }) },
        onKeyDown: function (e) {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); settle(function () { onCommit(val) }) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(function () { onCancel() }) }
        },
      })
    }

    function Row(props) {
      var node = props.node
      var depth = props.depth
      var isDir = node.type === 'directory'
      var isSelected = state.selected.has(node.path)
      var isRenaming = state.renaming === node.path
      var isDropTarget = state.dropTarget === node.path
      visibleRows.push(node.path)

      var rowMain = create('div', {
        className: 'expl-row-main' + (isSelected ? ' selected' : '') + (isDropTarget ? ' drop-target' : ''),
        'data-path': node.path,
        style: { paddingLeft: 8 + depth * 16 },
        draggable: true,
        onClick: function (e) { onRowClick(e, node) },
        onDoubleClick: function () { onRowDoubleClick(node) },
        onContextMenu: function (e) { onRowContext(e, node) },
        onDragStart: function (e) { onDragStart(e, node) },
        onDragOver: function (e) { if (isDir) { e.preventDefault(); e.stopPropagation(); if (state.dropTarget !== node.path) setState({ dropTarget: node.path }) } },
        onDragLeave: function (e) { if (state.dropTarget === node.path) setState({ dropTarget: null }) },
        onDrop: function (e) { if (isDir) onRowDrop(e, node) },
      },
        isDir || depth > 0
          ? create('span', {
              className: 'expl-caret' + (isDir ? ' expl-caret-big' + (depth === 0 ? ' expl-caret-root' : '') + (node.open ? ' open' : '') : ' expl-caret-sm'),
              onClick: function (e) { if (isDir) { e.stopPropagation(); toggleNode(node) } },
            }, '')
          : null,
        create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: iconSvgFor(node) } }),
        isRenaming
          ? create(NameInput, {
              initial: node.name,
              selectBase: true,
              onCommit: function (name) { commitRename(node.path, name) },
              onCancel: function () { setState({ renaming: null }) },
            })
        : create('span', { className: 'expl-name' }, node.name),
        !isDir ? create('span', { className: 'expl-size' }, formatSize(node.size)) : null,
        create('button', {
          className: 'expl-row-more',
          type: 'button',
          title: T('menu.actions'),
          'aria-label': T('menu.actions'),
          onClick: function (e) { onRowMore(e, node) },
        }, create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_MORE } })),
      )

      var children = []
      if (state.newItem && state.newItem.parent === node.path && isDir && node.open) {
        children.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 + (depth + 1) * 16 } },
            create('span', { className: 'expl-icon' }, state.newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(state.newItem.parent, name, state.newItem.isDir) },
              onCancel: function () { setState({ newItem: null }) },
            }),
          ),
        ))
      }
      if (isDir && node.open) {
        if (node.loading) {
          children.push(create('div', { key: '__loading__', className: 'expl-muted', style: { paddingLeft: 8 + (depth + 1) * 16 } }, T('files.loading')))
        } else {
          ;(node.children || []).forEach(function (c) { children.push(create(Row, { key: c.path, node: c, depth: depth + 1 })) })
        }
      }

      return create('div', { key: node.path, className: 'expl-row' }, rowMain, children)
    }

    function buildMenuItems(node) {
      var items = []
      var multi = state.selected.size > 1
      if (node) {
        if (!multi) {
          if (node.type !== 'directory') {
            items.push({ key: 'open-tab', label: T('menu.preview'), onClick: function () { openFileInTab(node.path) } })
            items.push({ key: 'open', label: T('menu.open'), onClick: openSelection, separatorAfter: true })
          } else {
            items.push({ key: 'open', label: T('menu.open'), onClick: openSelection, separatorAfter: true })
          }
          items.push({ key: 'rename', label: T('menu.rename'), onClick: function () { startRename(node) } })
          items.push({ key: 'trash', label: T('menu.trash'), danger: true, onClick: trashSelection, separatorAfter: true })
        } else {
          items.push({ key: 'trash', label: T('menu.trashMulti', { n: state.selected.size }), danger: true, onClick: trashSelection, separatorAfter: true })
        }
        if (node.type === 'directory') {
          items.push({ key: 'newfile', label: T('menu.newFile'), onClick: function () { startNew(node.path, false) } })
          items.push({ key: 'newfolder', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_NEW_FOLDER } }), T('menu.newFolder')], onClick: function () { startNew(node.path, true) }, separatorAfter: true })
        }
        items.push({ key: 'copy', label: T('menu.copyPath'), onClick: function () { copyPath(node) } })
        if (node.type !== 'directory') {
          items.push({ key: 'download', label: T('menu.download'), onClick: function () { downloadFile(node.path) } })
        }
      } else {
        items.push({ key: 'newfile', label: T('menu.newFile'), onClick: function () { startNew(state.cwd, false) } })
        items.push({ key: 'newfolder', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_NEW_FOLDER } }), T('menu.newFolder')], onClick: function () { startNew(state.cwd, true) } })
        items.push({ key: 'refresh', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }), T('explorer.refresh')], onClick: refresh, separatorAfter: true })
        if (state.selected.size > 0) items.push({ key: 'none', label: T('menu.deselect'), onClick: function () { setState({ selected: new Set(), lastIndex: null }) } })
      }
      return items
    }

    function Menu(props) {
      var menu = props.menu
      var menuRef = React.useRef(null)
      var posState = React.useState({ x: menu.x, y: menu.y })
      var pos = posState[0]
      var setPos = posState[1]
      React.useEffect(function () {
        var el = menuRef.current
        if (!el) return
        var rect = el.getBoundingClientRect()
        var margin = 6
        var nx = menu.x
        var ny = menu.y
        if (menu.x + rect.width > window.innerWidth - margin) nx = Math.max(margin, window.innerWidth - rect.width - margin)
        if (menu.y + rect.height > window.innerHeight - margin) ny = Math.max(margin, window.innerHeight - rect.height - margin)
        setPos({ x: nx, y: ny })
      }, [menu.x, menu.y])
      React.useEffect(function () {
        if (typeof document === 'undefined') return
        function down(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setState({ menu: null }) }
        function key(e) { if (e.key === 'Escape') setState({ menu: null }) }
        document.addEventListener('mousedown', down)
        document.addEventListener('keydown', key)
        return function () {
          document.removeEventListener('mousedown', down)
          document.removeEventListener('keydown', key)
        }
      }, [])

      var items = buildMenuItems(menu.node)
      var menuChildren = []
      items.forEach(function (it) {
        var children = it.label instanceof Array ? it.label : (function () {
          var match = it.label.match(/^([\u2190-\u2BFF\u{1F000}-\u{1FAFF}])\s*/u)
          if (match) return [create('span', { className: 'expl-menu-ico' }, match[1]), it.label.slice(match[0].length)]
          return [create('span', { className: 'expl-menu-ico-ph' }), it.label]
        })()
        menuChildren.push(create('button', {
          key: it.key,
          className: 'expl-menu-item' + (it.danger ? ' expl-danger' : ''),
          onClick: function () { setState({ menu: null }); it.onClick() },
        }, children))
        if (it.separatorAfter) menuChildren.push(create('div', { key: it.key + '-sep', className: 'expl-menu-sep' }))
      })
      return create('div', { ref: menuRef, className: 'expl-menu', style: { left: pos.x, top: pos.y } }, menuChildren)
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（面板与入口）
    //   Panel（右列 details 面板）/ HeaderAction（Session log 侧 📁）/ HeroAction（空白会话 📁）。
    // ------------------------------------------------------------------
    function Panel(props) {
      var s = useStore()
      var sessionId = props && props.sessionId
      // 客户端会话快照是本会话 cwd 的可信来源（与官方 DetailsPanel 同源，
      // 始终是当前会话所在项目目录，而非宿主启动时的根目录）。
      var useSessions = props && props.useSessions
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      var cwdRef = React.useRef(liveCwd)
      cwdRef.current = liveCwd || cwdRef.current
      var panelRef = React.useRef(null)
      var frameRef = React.useRef(null)
      var widthRef = React.useRef(DETAILS_DEFAULT)
      var dragRef = React.useRef({ startX: 0, startW: 0, active: false })

      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId, liveCwd])

      var setFrameWidth = React.useCallback(function (w) {
        var frame = frameRef.current
        if (!frame) return
        try {
          var gtc = frame.style.gridTemplateColumns
          if (!gtc) return
          var parts = gtc.trim().split(/\s+/)
          if (parts.length < 3) return
          parts[parts.length - 1] = Math.round(w) + 'px'
          frame.style.gridTemplateColumns = parts.join(' ')
        } catch (e) {}
      }, [])

      React.useEffect(function () {
        var el = panelRef.current
        if (!el) return
        var mo = null
        var cancelled = false
        function attach() {
          var frame = findFrameEl(el)
          if (!frame || mo) return
          frameRef.current = frame
          function sync() {
            try {
              var gtc = frame.style.gridTemplateColumns
              if (!gtc) return
              var parts = gtc.trim().split(/\s+/)
              if (parts.length < 3) return
              var last = parseFloat(parts[parts.length - 1])
              if (isNaN(last) || last <= 1) { setState({ open: false }); return }
              setState({ open: true })
              // Official 0.1.5 rightbar defaults to a viewport ratio. Keep
              // it within dsh-soup's 300-520px explorer contract.
              if (last < DETAILS_MIN || last > DETAILS_MAX) {
                if (Math.round(last) !== DETAILS_DEFAULT) setFrameWidth(DETAILS_DEFAULT)
                widthRef.current = DETAILS_DEFAULT
                return
              }
              if (Math.round(last) !== Math.round(widthRef.current)) {
                // 宿主是宽度偏好的权威（/native drag/窗口求解都可能改它）。
                // 插件只同步基准，不能把宿主拖出来的宽度强行拉回旧默认。
                widthRef.current = last
              }
            } catch (e) {}
          }
          mo = new MutationObserver(sync)
          mo.observe(frame, { attributes: true, attributeFilter: ['style'] })
          sync()
        }
        attach()
        if (!mo) {
          var tries = 0
          var t = setInterval(function () {
            if (cancelled || mo) { clearInterval(t); return }
            attach()
            if (++tries > 40) clearInterval(t)
          }, 100)
        }
        return function () { cancelled = true; if (mo) mo.disconnect() }
      }, [])

      function onResizeDown(e) {
        e.preventDefault()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
        dragRef.current = { startX: e.clientX, startW: widthRef.current, active: true }
        if (frameRef.current) { try { frameRef.current.style.transition = 'none' } catch (e) {} }
      }
      function onResizeMove(e) {
        if (!dragRef.current.active) return
        var w = clampW(dragRef.current.startW - (e.clientX - dragRef.current.startX))
        widthRef.current = w
        setFrameWidth(w)
      }
      function onResizeUp(e) {
        dragRef.current.active = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (frameRef.current) { try { frameRef.current.style.transition = '' } catch (e) {} }
      }

      visibleRows.length = 0

      var bodyChildren = []
      if (state.newItem && state.newItem.parent === state.cwd) {
        bodyChildren.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 } },
            create('span', { className: 'expl-icon' }, state.newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(state.newItem.parent, name, state.newItem.isDir) },
              onCancel: function () { setState({ newItem: null }) },
            }),
          ),
        ))
      }
      if (s.tree.length === 0 && !(state.newItem && state.newItem.parent === state.cwd)) {
        bodyChildren.push(create('div', { key: '__empty__', className: 'expl-muted' },
          s.cwd ? T('explorer.emptyDir') : T('explorer.waitCwd')))
      } else {
        s.tree.forEach(function (node) { bodyChildren.push(create(Row, { key: node.path, node: node, depth: 0 })) })
      }

      var container = create('div', {
        className: 'expl-body' + (state.dropTarget === state.cwd ? ' drop-target' : ''),
        onClick: onBlankClick,
        onContextMenu: onBlankContext,
        onDragOver: function (e) { e.preventDefault(); e.stopPropagation(); if (state.dropTarget !== state.cwd) setState({ dropTarget: state.cwd }) },
        onDragLeave: function (e) { if (state.dropTarget === state.cwd) setState({ dropTarget: null }) },
        onDrop: onBodyDrop,
      }, bodyChildren)

      return create('div', { ref: panelRef, className: 'expl-panel' },
        create('div', { className: 'expl-resize', onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
        create('div', { className: 'expl-head' },
          create('span', { className: 'expl-title' }, T('explorer.title')),
          create('div', { className: 'expl-head-btns' },
            create('button', {
              className: 'expl-btn',
              onClick: function () { startNew(state.cwd, true) },
              title: T('explorer.newFolderTitle'),
              'aria-label': T('explorer.newFolder'),
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_NEW_FOLDER } })),
            create('button', {
              className: 'expl-btn',
              onClick: function () { if (uploadInputEl) uploadInputEl.click() },
              title: T('explorer.upload'),
              'aria-label': T('explorer.upload'),
            }, '⬆'),
            create('button', {
              className: 'expl-btn',
              onClick: function () { refreshAll() },
              title: T('explorer.refreshTitle'),
              'aria-label': T('explorer.refresh'),
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } })),
            create('button', {
              className: 'expl-btn',
              onClick: function (event) {
                try {
                  if (layout && typeof layout.closeRightbar === 'function') layout.closeRightbar()
                  else if (layout && typeof layout.closeDetails === 'function') layout.closeDetails()
                } catch (e) {}
                setHeroDetailsWidth(event.currentTarget, 0)
              },
              title: T('explorer.close'),
              'aria-label': T('explorer.closePanel'),
            }, '✕'),
          ),
        ),
        create('div', { className: 'expl-path', title: s.cwd || '' }, s.cwd || '…'),
        (s.uploads && s.uploads.length) ? create('div', { className: 'expl-uploads' },
          s.uploads.map(function (u, i) {
            var pct = u.done ? null : (u.total ? Math.round((u.loaded / u.total) * 100) : 0)
            return create('div', { key: i, className: 'expl-upload-row' + (u.done ? ' expl-upload-done' : '') },
              create('span', { className: 'expl-upload-glyph' }, u.done ? '✓' : (u.down ? '⬇' : '⬆')),
              create('span', { className: 'expl-upload-text' },
                u.done ? u.name
                  : (u.down ? T('explorer.downloading') : T('explorer.uploading')) + (u.totalFiles > 1 ? '(' + u.idx + '/' + u.totalFiles + ') ' : '') + u.name,
              ),
              !u.done && u.total ? create('span', { className: 'expl-upload-pct' }, pct + '%') : null,
            )
          }),
        ) : null,
        create('input', { type: 'file', multiple: true, style: { display: 'none' }, ref: function (el) { uploadInputEl = el }, onChange: onUploadPicker }),
        s.error ? create('div', { className: 'expl-error' }, s.error) : null,
        s.notice ? create('div', { className: 'expl-notice' }, s.notice) : null,
        s.selected.size > 1
          ? create('div', { className: 'expl-bulk' }, T('explorer.bulkSelected', { n: s.selected.size }))
          : null,
        container,
        s.menu ? create('div', { className: 'expl-menu-mask', onMouseDown: function () { setState({ menu: null }) }, onContextMenu: function (e) { e.preventDefault(); setState({ menu: null }) } }) : null,
        s.menu ? create(Menu, { menu: s.menu }) : null,
        s.uploadConflict ? create('div', { className: 'expl-confirm-mask', role: 'dialog', 'aria-modal': 'true' },
          create('div', { className: 'expl-confirm' },
            create('div', { className: 'expl-confirm-title' }, T('explorer.overwriteTitle')),
            create('div', { className: 'expl-confirm-text' }, T('explorer.overwriteConfirm', { name: s.uploadConflict.name })),
            create('div', { className: 'expl-confirm-actions' },
              create('button', { type: 'button', className: 'expl-confirm-btn', onClick: function () { s.uploadConflict.resolve(false); setState({ uploadConflict: null }) } }, T('explorer.cancel')),
              create('button', { type: 'button', className: 'expl-confirm-btn expl-confirm-primary', autoFocus: true, onClick: function () { s.uploadConflict.resolve(true); setState({ uploadConflict: null }) } }, T('explorer.overwrite')),
            ),
          ),
        ) : null,
      )
    }

    function HeaderAction(props) {
      var s = useStore()
      var sessionId = props && props.sessionId
      var useSessions = props && props.useSessions
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      var cwdRef = React.useRef(liveCwd)
      cwdRef.current = liveCwd || cwdRef.current
      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId, liveCwd])
      return create('button', {
        type: 'button',
        className: 'expl-toggle expl-tool' + (s.open ? ' expl-active' : ''),
        onClick: function () {
          try {
            if (layout && typeof layout.closeRightbar === 'function') {
              if (s.open) layout.closeRightbar()
              else layout.openRightbar(true, false)
            } else if (s.open) layout.closeDetails()
            else layout.openDetails()
          } catch (e) {}
        },
        title: T('explorer.label'),
        'aria-label': T('explorer.label'),
      }, '📁')
    }

    function HeroAction(props) {
      var s = useStore()
      var session = props && props.session
      var useSessions = props && props.useSessions
      // DSH 0.1.2-alpha.1 移除了 SessionSnapshot.composerPhase（blank 阶段改由
      // conversationPhase() 从 blank/promptAttempted 派生）；旧版仍带该字段时沿用旧判断。
      var sessionId = (props && props.sessionId) || (session && session.sessionId)
      var blankPhase = session && (session.composerPhase !== undefined
        ? session.composerPhase === 'blank'
        : !session.promptAttempted)
      var blank = !!(session && session.blank && blankPhase)
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      React.useEffect(function () {
        if (blank) trackSession(sessionId, liveCwd)
      }, [blank, sessionId, liveCwd])
      if (!blank) return null
      return create('div', { className: 'expl-hero-dock' },
        create('button', {
          type: 'button',
          className: 'expl-toggle expl-tool' + (s.open ? ' expl-active' : ''),
          onClick: function (event) {
            if (s.open) {
              try {
                if (layout && typeof layout.closeRightbar === 'function') layout.closeRightbar()
                else if (layout && typeof layout.closeDetails === 'function') layout.closeDetails()
              } catch (e) {}
              setHeroDetailsWidth(event.currentTarget, 0)
            } else if (!setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)) {
              try {
                if (layout && typeof layout.openRightbar === 'function') layout.openRightbar(true, false)
                else if (layout && typeof layout.openDetails === 'function') layout.openDetails()
              } catch (e) {}
            }
          },
          title: T('explorer.label'),
          'aria-label': T('explorer.label'),
        }, '📁'))
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域二 · 会话内预览 · 🫚 姜（files tab 状态）
    //   files tab 状态机：打开/重载/关闭、FIFO(≤5)、会话切换按 cwd 裁剪。
    // ------------------------------------------------------------------
    // 文件标签页：右键/双击「预览」把文件以只读预览展示进会话区的「预览」
    // tab（原生 conversation.view 槽位，与 对话/轨迹 同级）。
    // markdown/html/json/csv 有专属渲染器；图片预览；其余按纯文本。
    // 状态存模块级 store，切走 tab 再切回来内容不丢。
    // ------------------------------------------------------------------
    var FILES_TAB_LABEL = function () { return T('files.tab') }

    /** 当前活跃会话：list/read/download 携带给宿主，供围栏直查该会话 cwd。 */
    var activeSessionId = null

    /** 同时打开的预览 tab 上限：超过后挤掉最早打开的（FIFO）。 */
    var FILES_MAX_OPEN = 5

    /** path 是否落在 base 目录子树内（base 为根或空时视为全量放行）。 */
    function withinScope(path, base) {
      if (!base || base === '/') return true
      return path === base || path.indexOf(base + '/') === 0
    }

    /**
     * 会话切换时按新 cwd 裁剪预览列表：范围外的 tab 自动关闭。
     * 若当前激活文件被裁掉，激活项顺移到剩余最后一个。
     * 列表无变化时返回原引用，避免触发多余渲染。
     */
    function pruneFilesToScope(files, cwd) {
      var kept = files.list.filter(function (f) { return withinScope(f.path, cwd) })
      try { window.__DFV_PRUNE = (window.__DFV_PRUNE || []) ; window.__DFV_PRUNE.push({ cwd: cwd, before: files.list.length, after: kept.length }) } catch (_) {}
      if (kept.length === files.list.length) return files
      var activeKept = kept.some(function (f) { return f.path === files.active })
      var active = files.active
      if (!activeKept) active = kept.length ? kept[kept.length - 1].path : null
      return { list: kept, active: active }
    }

    function setFiles(patch) {
      setState({ files: Object.assign({}, state.files, patch) })
      try {
        var f = state.files
        window.__DFV_DBG = { n: f.list.length, active: f.active, ops: ((window.__DFV_DBG && window.__DFV_DBG.ops) || 0) + 1 }
      } catch (_) {}
    }

    function askOverwrite(name) {
      return new Promise(function (resolve) {
        setState({ uploadConflict: { name: name, resolve: resolve } })
      })
    }

    function findFileEntry(path) {
      for (var i = 0; i < state.files.list.length; i++) {
        if (state.files.list[i].path === path) return state.files.list[i]
      }
      return null
    }

    /** 点击原生 header 的「预览」tab，把 view ring 切到预览视图。 */
    function activateFilesView() {
      try {
        var label = FILES_TAB_LABEL()
        var tabs = document.querySelectorAll('[role="tab"]')
        for (var i = 0; i < tabs.length; i++) {
          // 新版标签渲染可能引入空白节点，textContent 统一 trim 后比较
          if (String(tabs[i].textContent || '').trim() === label) { tabs[i].click(); return true }
        }
      } catch (err) {}
      return false
    }

    async function openFileInTab(path) {
      setState({ menu: null })
      var entry = findFileEntry(path)
      if (!entry) {
        entry = {
          path: path, name: baseName(path),
          loading: true, loaded: false, error: '',
          kind: null, content: '', dataUrl: '', data: '',
          truncated: false, size: 0,
          baseContent: '', baseMtime: undefined, baseSize: undefined,
          draft: '', dirty: false, editing: false, saving: false, justSaved: false,
          saveError: '', conflict: false,
        }
        // FIFO：最多同时 5 个预览，新开的挤掉最早打开的
        var list = state.files.list.slice()
        while (list.length >= FILES_MAX_OPEN) list.shift()
        list.push(entry)
        setFiles({ list: list, active: path })
      } else if (entry.loaded) {
        setFiles({ active: path })
        if (activateFilesView()) return
        setFiles({ overlay: true, overlayMax: false, overlayReturn: null })
        return
      } else {
        setFiles({ active: path })
      }
      if (!activateFilesView()) setFiles({ overlay: true, overlayMax: false, overlayReturn: null })
      var res = await rpc('read', { path: path, sessionId: activeSessionId })
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 600) })
        res = await rpc('read', { path: path, sessionId: activeSessionId })
      }
      var cur = findFileEntry(path)
      if (!cur) return
      cur.loading = false
      if (!res || !res.ok) {
        cur.error = (res && res.error) || T('explorer.readFail')
      } else {
        cur.error = ''
        cur.loaded = true
        cur.kind = res.kind
        cur.size = res.size || 0
        if (res.kind === 'text') {
          cur.truncated = !!res.truncated
          if (!cur.dirty && !cur.editing) {
            cur.content = res.content
            cur.baseContent = res.content
            cur.draft = res.content
            cur.baseMtime = res.mtime
            cur.baseSize = res.size
          } else {
            cur.conflict = true
            cur.diskMtime = res.mtime
            cur.diskSize = res.size
            scheduleAutoSave(path)
          }
        }
        else if (res.kind === 'image') { cur.dataUrl = 'data:' + res.mime + ';base64,' + res.data }
        else if (res.kind === 'pdf') { cur.data = res.data }
      }
      setFiles({ list: state.files.list.slice(), active: path })
    }

    // ------------------------------------------------------------------
    // 官方 file 地址桥接：dsh-soup 遮蔽 rightbar 槽位后，官方 SidebarRight
    // 面板组件永不挂载，会话里的文件产物卡片 / 内联文件链接调用
    // ctx.sidebarRight.openResource('dsh-resource://file/…') 会抛
    // "sidebarRight: no session surface is mounted"。这里把 file 地址解析
    // 回路径，转投 dsh-soup 自己的预览 tab（openFileInTab）。
    // ------------------------------------------------------------------
    var FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

    function decodeSegmentSafe(segment) {
      try { return decodeURIComponent(segment) } catch (e) { return null }
    }

    /** 解析官方 file 地址；非 file 地址或编码非法返回 null（与 workspace-path 同规则）。 */
    function parseFileAddress(address) {
      if (typeof address !== 'string' || address.indexOf(FILE_ADDRESS_PREFIX) !== 0) return null
      var end = address.search(/[?#]/)
      var body = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
      var parts = body.split('/')
      if (parts[0] === 'session') {
        var sessionId = decodeSegmentSafe(parts[1] || '')
        if (!sessionId) return null
        var segments = []
        for (var i = 2; i < parts.length; i++) {
          var seg = decodeSegmentSafe(parts[i])
          if (seg === null) return null
          segments.push(seg)
        }
        if (!segments.length) return null
        return { scope: 'session', sessionId: sessionId, path: segments.join('/') }
      }
      if (parts[0] === 'absolute') {
        var absolute = []
        for (var j = 1; j < parts.length; j++) {
          var abs = decodeSegmentSafe(parts[j])
          if (abs === null) return null
          absolute.push(abs)
        }
        if (!absolute.length) return null
        return { scope: 'absolute', path: '/' + absolute.join('/') }
      }
      return null
    }

    /** 同步判断：该 file 地址是否应由 dsh-soup 接住（当前会话或绝对路径）。 */
    function fileAddressMatches(address, sessionIdHint) {
      var parsed = parseFileAddress(address)
      if (!parsed) return false
      if (parsed.scope === 'session' && (sessionIdHint || parsed.sessionId) !== activeSessionId) return false
      return true
    }

    /** file 地址 → dsh-soup 预览。session 作用域的路径相对会话 cwd，
     *  必须先解析成绝对路径再读——宿主 read 对相对路径按服务进程 cwd
     *  （桌面端为 launch-root）解析，直接透传会 ENOENT。 */
    async function openFileAddressInSoup(address, sessionIdHint) {
      var parsed = parseFileAddress(address)
      if (!parsed) return false
      var sid = sessionIdHint || parsed.sessionId
      if (parsed.scope === 'session' && sid !== activeSessionId) return false
      var target = parsed.path
      if (parsed.scope === 'session' && target.charAt(0) !== '/') {
        var cwd = state.cwd || await defaultCwd(parsed.sessionId)
        if (cwd) target = String(cwd).replace(/\/+$/, '') + '/' + target
      }
      openFileInTab(target)
      return true
    }

    async function reloadFile(path) {
      var entry = findFileEntry(path)
      if (!entry) return
      // 复位 loaded，让 openFileInTab 走重读路径而不是「已打开直接激活」。
      entry.loaded = false
      await openFileInTab(path)
    }

    function isEditableTextFile(path) {
      var kind = previewKind(path)
      var ext = extOfName(path)
      return kind === 'markdown' || kind === 'html' || kind === 'json'
        || Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, ext)
    }

    function startEditing(path) {
      var entry = findFileEntry(path)
      if (!entry || !entry.loaded || entry.kind !== 'text') return
      if (!isEditableTextFile(path)) {
        entry.saveError = T('files.notEditable')
        setFiles({ list: state.files.list.slice() })
        return
      }
      if (entry.truncated) {
        entry.saveError = T('files.truncatedEdit')
        setFiles({ list: state.files.list.slice() })
        return
      }
      if (!entry.editing) {
        entry.draft = entry.dirty ? entry.draft : entry.content
        entry.editing = true
      }
      entry.saveError = ''
      setFiles({ list: state.files.list.slice() })
    }

    function scheduleAutoSave(path) {
      clearTimeout(autoSaveTimers.get(path))
      autoSaveTimers.set(path, setTimeout(function () {
        autoSaveTimers.delete(path)
        saveActiveFile(path)
      }, AUTO_SAVE_DELAY_MS))
    }

    function showSavedIndicator(path) {
      clearTimeout(autoSaveSavedTimers.get(path))
      autoSaveSavedTimers.set(path, setTimeout(function () {
        autoSaveSavedTimers.delete(path)
        var entry = findFileEntry(path)
        if (!entry || entry.saving || entry.dirty) return
        entry.justSaved = false
        setFiles({ list: state.files.list.slice() })
      }, SAVED_INDICATOR_MS))
    }

    function manuallySaveFile(path) {
      manualSavePaths.add(path)
      saveActiveFile(path)
    }

    function stopEditing(path) {
      var entry = findFileEntry(path)
      if (!entry || !entry.editing) return
      clearTimeout(autoSaveTimers.get(path))
      autoSaveTimers.delete(path)
      clearTimeout(autoSaveSavedTimers.get(path))
      autoSaveSavedTimers.delete(path)
      if (entry.dirty) {
        if (entry.saving) entry.saveOnExit = true
        else saveActiveFile(path)
      }
      entry.editing = false
      setFiles({ list: state.files.list.slice() })
    }

    function updateDraft(path, value) {
      var entry = findFileEntry(path)
      if (!entry || !entry.editing) return
      entry.draft = value
      entry.dirty = value !== entry.baseContent
      setFiles({ list: state.files.list.slice() })
      scheduleAutoSave(path)
    }

    async function saveActiveFile(path) {
      var entry = findFileEntry(path)
      if (!entry || (!entry.editing && !entry.saveOnExit) || entry.saving || entry.truncated) return
      if (!entry.dirty) return
      entry.saving = true
      entry.saveError = ''
      setFiles({ list: state.files.list.slice() })
      if (entry.conflict) {
        entry.baseMtime = entry.diskMtime
        entry.baseSize = entry.diskSize
        entry.conflict = false
      }
      var savedDraft = entry.draft
      var wasManualSave = manualSavePaths.has(path)
      manualSavePaths.delete(path)
      var res = await rpc('write', {
        path: path,
        content: entry.draft,
        expectedMtime: entry.baseMtime,
        expectedSize: entry.baseSize,
        sessionId: activeSessionId,
      })
      var cur = findFileEntry(path)
      if (!cur) return
      cur.saving = false
      if (!res || !res.ok) {
        cur.saveError = (res && res.error) || T('files.saveTitle')
        if (res && res.conflict) {
          cur.conflict = true
          cur.diskMtime = res.mtime
          cur.diskSize = res.size
        }
        if (cur.editing || cur.saveOnExit) scheduleAutoSave(path)
        setFiles({ list: state.files.list.slice() })
        return
      }
      cur.content = savedDraft
      cur.baseContent = savedDraft
      cur.dirty = cur.draft !== savedDraft
      if (!cur.dirty) cur.saveOnExit = false
      else if (cur.editing || cur.saveOnExit) scheduleAutoSave(path)
      cur.conflict = false
      cur.saveError = ''
      cur.justSaved = wasManualSave
      cur.size = res.size
      cur.baseMtime = res.mtime
      cur.baseSize = res.size
      setFiles({ list: state.files.list.slice() })
      refresh()
      if (wasManualSave) showSavedIndicator(path)
    }

    function closeFileTab(path) {
      var list = state.files.list
      var idx = -1
      for (var i = 0; i < list.length; i++) if (list[i].path === path) { idx = i; break }
      if (idx < 0) return
      clearTimeout(autoSaveTimers.get(path))
      autoSaveTimers.delete(path)
      clearTimeout(autoSaveSavedTimers.get(path))
      autoSaveSavedTimers.delete(path)
      var closing = list[idx]
      if (closing.dirty && typeof window !== 'undefined' && !window.confirm(T('files.unsavedConfirm'))) return
      var next = list.slice(0, idx).concat(list.slice(idx + 1))
      var active = state.files.active
      if (active === path) {
        var neighbor = next[Math.min(idx, next.length - 1)]
        active = neighbor ? neighbor.path : null
      }
      setFiles({ list: next, active: active })
    }

    function setActiveFile(path) {
      setFiles({ active: path })
    }

    // ------------------------------------------------------------------
    // ▓▓ 区域二 · 会话内预览 · 🫚 姜（渲染器）
    //   按扩展名分派 md/html/pdf/notebook/json/csv + 图片/纯文本兜底 + FileContent + FilesView 子标签条。
    // ------------------------------------------------------------------
    // 文件视图（conversation.view 'dsh-soup-files'）：
    // 子 tab 条 + 只读预览区（markdown/html/json/csv 渲染 / 图片预览 / 二进制提示）。
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // 预览渲染器：按扩展名分派（信任模型参考 JupyterLab viewer——
    // markdown 走不可信安全渲染管线，html 进无 allow-* 的沙箱 iframe）。
    // ------------------------------------------------------------------
    /** 取路径小写扩展名。 */
    function extOfName(p) {
      var m = /\.([A-Za-z0-9]+)$/.exec(String(p || ''))
      return m ? m[1].toLowerCase() : ''
    }

    /** 预览渲染器类型：markdown | html | json | csv | tsv | notebook | code | text。 */
    function previewKind(path) {
      var ext = extOfName(path)
      if (ext === 'md' || ext === 'markdown') return 'markdown'
      if (ext === 'html' || ext === 'htm') return 'html'
      if (ext === 'json') return 'json'
      if (ext === 'ipynb') return 'notebook'
      if (ext === 'csv') return 'csv'
      if (ext === 'tsv') return 'tsv'
      return 'text'
    }

    function codeMirrorLanguage(path) {
      var ext = extOfName(path)
      var factory = ext === 'py' ? CMLangs.python && CMLangs.python.python
        : ext === 'js' || ext === 'mjs' || ext === 'cjs' ? CMLangs.javascript && CMLangs.javascript.javascript
          : ext === 'jsx' ? CMLangs.javascript && CMLangs.javascript.javascript
            : ext === 'ts' || ext === 'mts' || ext === 'cts' ? CMLangs.javascript && CMLangs.javascript.javascript
              : ext === 'tsx' ? CMLangs.javascript && CMLangs.javascript.javascript
                : ext === 'json' || ext === 'jsonc' ? CMLangs.json && CMLangs.json.json
                  : ext === 'md' || ext === 'markdown' || ext === 'mdx' ? CMLangs.markdown && CMLangs.markdown.markdown
                    : ext === 'html' || ext === 'htm' ? CMLangs.html && CMLangs.html.html
                      : ext === 'css' || ext === 'scss' || ext === 'less' ? CMLangs.css && CMLangs.css.css
                        : ext === 'sql' ? CMLangs.sql && CMLangs.sql.sql
                          : ext === 'xml' ? CMLangs.xml && CMLangs.xml.xml
                            : null
      if (!factory) return null
      try {
        if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx') return factory({ jsx: true })
        if (ext === 'ts' || ext === 'mts' || ext === 'cts' || ext === 'tsx') return factory({ typescript: true, jsx: ext === 'tsx' })
        return factory()
      } catch (err) { return null }
    }

    var PREVIEW_HIGHLIGHT_STYLE = (CMLanguage && CMLanguage.HighlightStyle && CMHighlightTags)
      ? CMLanguage.HighlightStyle.define([
          { tag: CMHighlightTags.comment, color: 'var(--dsh-soup-code-comment)' },
          { tag: CMHighlightTags.keyword, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.controlKeyword, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.definitionKeyword, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.moduleKeyword, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.operator, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.operatorKeyword, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.string, color: 'var(--dsh-soup-code-string)' },
          { tag: CMHighlightTags.escape, color: 'var(--dsh-soup-code-string)' },
          { tag: CMHighlightTags.regexp, color: 'var(--dsh-soup-code-string)' },
          { tag: CMHighlightTags.number, color: 'var(--dsh-soup-code-number)' },
          { tag: CMHighlightTags.bool, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.null, color: 'var(--dsh-soup-code-keyword)' },
          { tag: CMHighlightTags.typeName, color: 'var(--dsh-soup-code-type)' },
          { tag: CMHighlightTags.namespace, color: 'var(--dsh-soup-code-type)' },
          { tag: CMHighlightTags.variableName, color: 'var(--dsh-soup-code-variable)' },
          { tag: CMHighlightTags.function(CMHighlightTags.variableName), color: 'var(--dsh-soup-code-function)' },
          { tag: CMHighlightTags.className, color: 'var(--dsh-soup-code-function)' },
          { tag: CMHighlightTags.macroName, color: 'var(--dsh-soup-code-function)' },
          { tag: CMHighlightTags.propertyName, color: 'var(--dsh-soup-code-property)' },
          { tag: CMHighlightTags.punctuation, color: 'var(--dsh-soup-code-punctuation)' },
          { tag: CMHighlightTags.bracket, color: 'var(--dsh-soup-code-punctuation)' },
          { tag: CMHighlightTags.invalid, color: 'var(--dsh-soup-code-invalid)' },
        ])
      : null

    var PREVIEW_JSON_HIGHLIGHT_STYLE = (CMLanguage && CMLanguage.HighlightStyle && CMHighlightTags)
      ? CMLanguage.HighlightStyle.define([
          { tag: CMHighlightTags.propertyName, color: 'var(--dsh-soup-json-property)' },
          { tag: CMHighlightTags.string, color: 'var(--dsh-soup-json-string)' },
          { tag: CMHighlightTags.number, color: 'var(--dsh-soup-json-number)' },
          { tag: CMHighlightTags.bool, color: 'var(--dsh-soup-json-literal)' },
          { tag: CMHighlightTags.null, color: 'var(--dsh-soup-json-literal)' },
          { tag: CMHighlightTags.punctuation, color: 'var(--dsh-soup-json-punctuation)' },
          { tag: CMHighlightTags.bracket, color: 'var(--dsh-soup-json-punctuation)' },
          { tag: CMHighlightTags.invalid, color: 'var(--dsh-soup-code-invalid)' },
        ])
      : null

    /** CodeMirror 6 编辑器：文本、行号、语法、高亮、光标和滚动由同一 EditorView 管理。 */
    function TextEditor(props) {
      var entry = props.entry
      var hostRef = React.useRef(null)
      var viewRef = React.useRef(null)
      React.useEffect(function () {
        if (!hostRef.current || !CMEditorView || !CMEditorState) return
        var EditorView = CMEditorView.EditorView
        var EditorState = CMEditorState.EditorState
        var extensions = [
          EditorView.updateListener.of(function (update) {
            if (update.docChanged) updateDraft(entry.path, update.state.doc.toString())
          }),
        ]
        if (CMKeymap && CMKeymap.keymap) extensions.push(CMKeymap.keymap.of([
          { key: 'Mod-s', run: function () { manuallySaveFile(entry.path); return true } },
        ]))
        if (CMCommands) {
          if (CMCommands.history) extensions.push(CMCommands.history())
          if (CMCommands.historyKeymap && CMKeymap && CMKeymap.keymap) extensions.push(CMKeymap.keymap.of(CMCommands.historyKeymap))
          if (CMCommands.defaultKeymap && CMKeymap && CMKeymap.keymap) extensions.push(CMKeymap.keymap.of(CMCommands.defaultKeymap))
          if (CMCommands.indentWithTab && CMKeymap && CMKeymap.keymap) extensions.push(CMKeymap.keymap.of([CMCommands.indentWithTab]))
        }
        if (CMLanguage) {
          if (CMLanguage.bracketMatching) extensions.push(CMLanguage.bracketMatching())
          if (CMLanguage.indentOnInput) extensions.push(CMLanguage.indentOnInput())
        }
        if (CMEditorView.lineNumbers) extensions.push(CMEditorView.lineNumbers())
        if (CMEditorView.drawSelection) extensions.push(CMEditorView.drawSelection())
        if (CMEditorView.highlightActiveLine) extensions.push(CMEditorView.highlightActiveLine())
        if (CMEditorView.highlightSpecialChars) extensions.push(CMEditorView.highlightSpecialChars())
        var language = codeMirrorLanguage(entry.path)
        if (language) extensions.push(language)
        var ext = extOfName(entry.path)
        var highlightStyle = (ext === 'json' || ext === 'jsonc')
          ? PREVIEW_JSON_HIGHLIGHT_STYLE
          : PREVIEW_HIGHLIGHT_STYLE
        if (highlightStyle) extensions.push(CMLanguage.syntaxHighlighting(highlightStyle))
        viewRef.current = new EditorView({
          state: EditorState.create({ doc: entry.draft, extensions: extensions }),
          parent: hostRef.current,
        })
        viewRef.current.focus()
        return function () {
          if (viewRef.current) { viewRef.current.destroy(); viewRef.current = null }
        }
      }, [entry.path])
      if (!CMEditorView || !CMEditorState) {
        return create('textarea', {
          className: 'dfv-editor', value: entry.draft, spellCheck: false,
          'aria-label': entry.name,
          onChange: function (e) { updateDraft(entry.path, e.target.value) },
        })
      }
      return create('div', { className: 'dfv-cm-editor', ref: hostRef, 'aria-label': entry.name })
    }

    // CODE_LANG_BY_EXT 已上移 client/file-icons.js（iconSvgFor 兜底共用）。

    /** 超过该字符数的代码文件不做高亮（Shiki 首次高亮的耗时保护）。 */
    var CODE_HIGHLIGHT_MAX_CHARS = 400000

    /** RFC 4180 风格的分隔符解析（引号感知，"" 转义），返回行数组。 */
    function parseDelimited(text, delim) {
      var rows = []
      var row = []
      var field = ''
      var inQuotes = false
      var n = text.length
      for (var i = 0; i < n; i++) {
        var ch = text[i]
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
          } else {
            field += ch
          }
        } else if (ch === '"') {
          inQuotes = true
        } else if (ch === delim) {
          row.push(field); field = ''
        } else if (ch === '\n') {
          row.push(field); rows.push(row); row = []; field = ''
        } else if (ch !== '\r') {
          field += ch
        }
      }
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
      return rows
    }

    /** 把 pretty JSON 切成着色 token 数组（纯文本/React 节点，无 innerHTML）。 */
    function jsonColorNodes(pretty) {
      var out = []
      var last = 0
      var re = /("(?:\\.|[^"\\])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
      var m
      while ((m = re.exec(pretty)) !== null) {
        if (m.index > last) out.push(pretty.slice(last, m.index))
        if (m[1] !== undefined) {
          out.push(create('span', { key: out.length, className: m[2] ? 'dfv-tok-key' : 'dfv-tok-str' }, m[1]))
          if (m[2]) out.push(m[2])
        } else if (m[0] === 'true' || m[0] === 'false') {
          out.push(create('span', { key: out.length, className: 'dfv-tok-bool' }, m[0]))
        } else if (m[0] === 'null') {
          out.push(create('span', { key: out.length, className: 'dfv-tok-null' }, m[0]))
        } else {
          out.push(create('span', { key: out.length, className: 'dfv-tok-num' }, m[0]))
        }
        last = re.lastIndex
      }
      if (last < pretty.length) out.push(pretty.slice(last))
      return out
    }

    var CSV_MAX_ROWS = 500
    var CSV_MAX_COLS = 64

    // ------------------------------------------------------------------
    // Markdown 相对图片 → dsh-soup 同源 img 端点绝对 URL。
    // 预览 markdown 时，DSH 的 MarkdownText 渲染器「禁相对链接/相对资源」，
    // `![x](view.jpg)` 这类相对路径图片会被直接丢弃。因此把 src 改写成
    // 本插件同名端点（GET /api/dsh-soup/img）的同源绝对地址，交给 <img>
    // 从磁盘内联加载。绝对（http/https/data 等）与根相对路径放行不处理。
    // ------------------------------------------------------------------
    var MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
    function posixResolve(dir, rel) {
      var combined = (String(dir || '/').replace(/\/+$/, '') || '/') + '/' + String(rel)
      var out = []
      combined.split('/').forEach(function (seg) {
        if (seg === '' || seg === '.') return
        if (seg === '..') { if (out.length) out.pop(); return }
        out.push(seg)
      })
      return '/' + out.join('/')
    }
    function imgUrl(absPath) {
      return hostBase() + '/api/dsh-soup/img?p=' + encodeURIComponent(absPath)
    }
    function absolutizeMarkdownImages(text, baseDir) {
      if (!text) return text
      var dir = baseDir || '/'
      return text.replace(MD_IMG_RE, function (m0, alt, src) {
        var s = String(src || '').trim()
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(s)) return m0
        return '![' + alt + '](' + imgUrl(posixResolve(dir, s)) + ')'
      })
    }

    var MarkdownRenderBoundary = React.Component
      ? class MarkdownRenderBoundary extends React.Component {
          constructor(props) {
            super(props)
            this.state = { failed: false }
          }
          static getDerivedStateFromError() { return { failed: true } }
          componentDidCatch(err) {
            try { window.__DSH_MARKDOWN_PREVIEW_ERROR = String((err && err.message) || err) } catch (_) {}
          }
          componentDidUpdate(prevProps) {
            if (this.state.failed && prevProps.text !== this.props.text) this.setState({ failed: false })
          }
          render() {
            if (this.state.failed) return create(SafeMarkdownFallback, { text: this.props.text })
            return this.props.children
          }
        }
      : function MarkdownRenderBoundaryFallback(props) { return props.children }

    // Last-resort renderer for hosts whose MarkdownText/CodeBlock bundle throws.
    // Keep the document readable and, importantly, never expose the full source
    // as one giant preformatted block just because one fenced block failed.
    function SafeMarkdownInline(text) {
      var parts = String(text || '').split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*))/g)
      return parts.map(function (part, i) {
        if (/^`[^`\n]+`$/.test(part)) {
          return create('code', { key: i, className: 'markdown-inline-code' }, part.slice(1, -1))
        }
        if (/^\*\*[^*\n]+\*\*$/.test(part)) {
          return create('strong', { key: i }, part.slice(2, -2))
        }
        if (/^\*[^*\n]+\*$/.test(part)) {
          return create('em', { key: i }, part.slice(1, -1))
        }
        return part
      })
    }
    function SafeMarkdownFallback(props) {
      var lines = String(props.text || '').split(/\r?\n/)
      var blocks = []
      var paragraph = []
      var code = null
      function flushParagraph() {
        if (!paragraph.length) return
        blocks.push(create('p', { key: blocks.length }, SafeMarkdownInline(paragraph.join(' '))))
        paragraph = []
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        var fence = /^\s*```\s*([\w-]*)\s*$/.exec(line)
        if (fence) {
          if (code) {
            blocks.push(create('pre', { key: blocks.length, className: 'dfv-code' }, create('code', null, code.lines.join('\n'))))
            code = null
          } else {
            flushParagraph()
            code = { lang: fence[1], lines: [] }
          }
          continue
        }
        if (code) { code.lines.push(line); continue }
        if (/^\s*$/.test(line)) { flushParagraph(); continue }
        // GFM table: header row followed by the required delimiter row.
        if (line.indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
          flushParagraph()
          var splitRow = function (value) {
            var s = String(value).trim().replace(/^\|/, '').replace(/\|$/, '')
            return s.split('|').map(function (cell) { return cell.trim() })
          }
          var headers = splitRow(line)
          i += 1
          var tableRows = []
          while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && !/^\s*$/.test(lines[i + 1])) {
            i += 1
            tableRows.push(splitRow(lines[i]))
          }
          var head = create('tr', null, headers.map(function (cell, hi) {
            return create('th', { key: hi, className: 'dfv-th' }, SafeMarkdownInline(cell))
          }))
          var bodyRows = tableRows.map(function (row, ri) {
            return create('tr', { key: ri }, headers.map(function (_, ci) {
              return create('td', { key: ci, className: 'dfv-td' }, SafeMarkdownInline(row[ci] || ''))
            }))
          })
          var table = create('table', { className: 'dfv-table' },
            create('thead', null, head),
            create('tbody', null, bodyRows))
          blocks.push(create('div', { key: blocks.length, className: 'dfv-table-wrap' }, table))
          continue
        }
        var heading = /^(#{1,6})\s+(.+)$/.exec(line)
        if (heading) {
          flushParagraph()
          blocks.push(create('h' + heading[1].length, { key: blocks.length }, SafeMarkdownInline(heading[2])))
        } else {
          paragraph.push(line)
        }
      }
      if (code) blocks.push(create('pre', { key: blocks.length, className: 'dfv-code' }, create('code', null, code.lines.join('\n'))))
      flushParagraph()
      return create('div', { className: 'dfv-safe-md' }, blocks)
    }

    function MarkdownPreview(props) {
      var text = props.text
      if (MarkdownText) {
        // Keep the original MarkdownText source contract visible for host integrations.
        // create(MarkdownText, { text: md })
        var md = props.baseDir ? absolutizeMarkdownImages(text, props.baseDir) : text
        var lines = String(md || '').split(/\r?\n/)
        var chunks = []
        var normal = []
        var fenced = null
        function pushNormal() {
          if (!normal.length) return
          var value = normal.join('\n')
          if (value.trim() !== '') chunks.push(create(MarkdownRenderBoundary, { key: 'md-' + chunks.length, text: value }, create(MarkdownText, { text: value })))
          normal = []
        }
        function pushTable(headerLine) {
          var splitRow = function (value) {
            var s = String(value).trim().replace(/^\|/, '').replace(/\|$/, '')
            return s.split('|').map(function (cell) { return cell.trim() })
          }
          var headers = splitRow(headerLine)
          var renderCell = function (cell, key) {
            return create(MarkdownRenderBoundary, { key: key, text: cell }, create(MarkdownText, { text: cell }))
          }
          var head = create('tr', null, headers.map(function (cell, hi) {
            return create('th', { key: hi, className: 'dfv-th' }, renderCell(cell, 'th-' + hi))
          }))
          var rows = []
          while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && !/^\s*$/.test(lines[i + 1])) {
            var nextRow = splitRow(lines[i + 1])
            if (nextRow.length < headers.length) break
            i += 1
            rows.push(nextRow)
          }
          var body = rows.map(function (row, ri) {
            return create('tr', { key: ri }, headers.map(function (_, ci) {
              return create('td', { key: ci, className: 'dfv-td' }, renderCell(row[ci] || '', 'td-' + ri + '-' + ci))
            }))
          })
          chunks.push(create('div', { key: 'table-' + chunks.length, className: 'dfv-table-wrap' },
            create('table', { className: 'dfv-table' },
              create('thead', null, head), create('tbody', null, body))))
        }
        for (var i = 0; i < lines.length; i++) {
          var fence = /^\s*```\s*([\w-]*)\s*$/.exec(lines[i])
          if (fence) {
            if (fenced) {
              chunks.push(create('pre', { key: 'code-' + chunks.length, className: 'dfv-code md-code-block', 'data-language': fenced.lang }, create('code', null, fenced.lines.join('\n'))))
              fenced = null
            } else {
              pushNormal()
              fenced = { lang: fence[1], lines: [] }
            }
          } else if (fenced) {
            fenced.lines.push(lines[i])
          } else if (lines[i].indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
            pushNormal()
            i += 1
            pushTable(lines[i - 1])
          } else {
            normal.push(lines[i])
          }
        }
        if (fenced) chunks.push(create('pre', { key: 'code-' + chunks.length, className: 'dfv-code md-code-block', 'data-language': fenced.lang }, create('code', null, fenced.lines.join('\n'))))
        pushNormal()
        return create('div', { className: 'dfv-md-wrap' }, create('div', { className: 'dfv-md' }, chunks))
      }
      // 回退：宿主缺 ui-primitives 时按纯文本展示
      return create('pre', { className: 'dfv-code' }, text)
    }

    // 对齐官方 document-preview：HTML 运行在 Blob + opaque origin iframe 中。
    // 父页面先从同目录收集有限的静态 CSS / 传统 JS，再在 iframe 内创建资源 URL；
    // iframe 只有脚本执行权，不具备 same-origin，因此不能访问 DSH 页面、Cookie 或 RPC。
    var HTML_ASSET_MAX_BYTES = 4 * 1024 * 1024
    var HTML_TOTAL_MAX_BYTES = 32 * 1024 * 1024
    var HTML_MAX_ASSETS = 64

    function utf8ToBase64(text) {
      var bytes = new TextEncoder().encode(String(text || ''))
      var chunks = []
      for (var offset = 0; offset < bytes.length; offset += 32768) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(offset + 32768, bytes.length))))
      }
      return btoa(chunks.join(''))
    }
    function base64ToText(data) {
      var raw = atob(data)
      var bytes = new Uint8Array(raw.length)
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    function isHtmlRelative(ref) {
      return !!ref && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/i.test(ref) && ref.indexOf('\0') === -1 && ref.indexOf('\\') === -1
    }
    function htmlAssetRef(ref) {
      var cut = String(ref || '').search(/[?#]/)
      return cut === -1 ? String(ref || '') : String(ref || '').slice(0, cut)
    }
    function createPackedHtmlDocument(bundle) {
      // bundle JSON 以 UTF-8 base64 传入，避免 HTML 或资源文本突破 script 字面量。
      var payload = utf8ToBase64(JSON.stringify(bundle))
      return '<!doctype html><meta charset="utf-8"><script>(()=>{' +
        'const bytes=d=>Uint8Array.from(atob(d),c=>c.charCodeAt(0));' +
        'const text=d=>new TextDecoder("utf-8",{fatal:true}).decode(bytes(d));' +
        'const bundle=JSON.parse(text("' + payload + '"));let html=bundle.html;' +
        'if(bundle.assets.length){const parsed=new DOMParser().parseFromString(html,"text/html");' +
        'for(const asset of bundle.assets){const script=asset.kind==="script";' +
        'const url=URL.createObjectURL(new Blob([asset.text],{type:script?"application/javascript":"text/css"}));' +
        'const attr=script?"src":"href";const selector=script?"script[src]":"link[rel~=\"stylesheet\" i][href]";' +
        'for(const el of parsed.querySelectorAll(selector))if(el.getAttribute(attr)===asset.reference)el.setAttribute(attr,url);}' +
        'html="<!doctype html>"+parsed.documentElement.outerHTML;}document.open();document.write(html);document.close();})()<\/script>'
    }
    /**
     * DSH Desktop 的 WebView 对 blob: 沙箱中的 WebGL / 多个本地经典脚本存在
     * 兼容性差异（Three.js 多文件页面会白屏）。资源已经由父页面安全读取后，
     * 直接内联回 srcDoc 可保留文档原有的执行时序与运行环境：CSS 变 style，
     * 经典 script 的 src 变为同位置的内联脚本。iframe 仍是 opaque sandbox。
     */
    function inlinePackedHtml(bundle) {
      if (!bundle.assets.length) return bundle.html
      var template = document.createElement('template')
      template.innerHTML = bundle.html
      for (var i = 0; i < bundle.assets.length; i++) {
        var asset = bundle.assets[i]
        if (asset.kind === 'script') {
          var scripts = template.content.querySelectorAll('script[src]')
          for (var j = 0; j < scripts.length; j++) {
            if (scripts[j].getAttribute('src') !== asset.reference) continue
            scripts[j].removeAttribute('src')
            scripts[j].textContent = asset.text
          }
        } else {
          var links = template.content.querySelectorAll('link[rel~="stylesheet" i][href]')
          for (var k = 0; k < links.length; k++) {
            if (links[k].getAttribute('href') !== asset.reference) continue
            var style = document.createElement('style')
            style.textContent = asset.text
            links[k].replaceWith(style)
          }
        }
      }
      return '<!doctype html>' + template.innerHTML
    }
    // 历史兼容：大量网页导出物（尤其微信文章）用 data-src 延迟图片、或把
    // #js_content 初始设为隐藏。无论走打包 iframe 还是兼容回退都应用这层。
    function prepareHtmlText(text) {
      var next = String(text || '')
      if (next.indexOf('js_content') !== -1 || next.indexOf('data-src=') !== -1) {
        var inject = '<style>#js_content{visibility:visible!important;opacity:1!important;}</style>'
        next = /<\/head>/i.test(next) ? next.replace(/<\/head>/i, inject + '</head>') : inject + next
        next = next.replace(/(<img\b[^>]*?)\sdata-src=/gi, '$1 src=')
      }
      return next
    }
    async function packHtmlPreview(text, rootPath, sessionId, signal) {
      var source = prepareHtmlText(text)
      var encodedRoot = new TextEncoder().encode(source)
      if (encodedRoot.byteLength > HTML_TOTAL_MAX_BYTES) throw new Error('HTML 文档超过 32 MB 限制')
      var template = document.createElement('template')
      template.innerHTML = source
      // base 会改变浏览器自己的 URL 解析语义；官方实现对此不打包，保持原文。
      if (template.content.querySelector('base[href]')) return { html: source, assets: [] }
      var assets = []
      var seen = Object.create(null)
      var total = encodedRoot.byteLength
      var elements = template.content.querySelectorAll('script[src],link[href]')
      for (var i = 0; i < elements.length; i++) {
        if (signal.aborted) throw new Error('cancelled')
        var el = elements[i]
        var script = el.localName === 'script'
        var type = (el.getAttribute('type') || '').trim().toLowerCase()
        if (script && type && type !== 'text/javascript' && type !== 'application/javascript') continue
        if (!script && !(el.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
        var reference = el.getAttribute(script ? 'src' : 'href') || ''
        var bare = htmlAssetRef(reference)
        if (!isHtmlRelative(reference) || !(script ? /\.js$/i : /\.css$/i).test(bare)) continue
        var kind = script ? 'script' : 'stylesheet'
        var key = kind + ':' + reference
        if (seen[key]) continue
        // 与官方不同，dsh-soup 预览优先保证"文件本体可打开"：超出上限、
        // 缺失或非 UTF-8 的单项资源只跳过，不让整个 HTML 变成错误页。
        if (assets.length >= HTML_MAX_ASSETS) break
        seen[key] = true
        var res = await rpc('read-related', { path: rootPath, relativePath: bare, sessionId: sessionId })
        if (signal.aborted) throw new Error('cancelled')
        if (!res || !res.ok || res.size > HTML_ASSET_MAX_BYTES) continue
        try {
          var assetText = base64ToText(res.data)
          var assetBytes = new TextEncoder().encode(assetText).byteLength
          if (total + assetBytes > HTML_TOTAL_MAX_BYTES) continue
          total += assetBytes
          assets.push({ kind: kind, reference: reference, text: assetText })
        } catch (err) { /* 单个非 UTF-8 依赖不阻断 HTML 本体 */ }
      }
      return { html: source, assets: assets }
    }
    function HtmlPreview(props) {
      var state = React.useState({ key: null, url: null, fallback: false })
      var frame = state[0]
      var setFrame = state[1]
      var key = String(props.path || '') + '\0' + String(props.text || '')
      React.useEffect(function () {
        var controller = new AbortController()
        var url = null
        setFrame({ key: key, url: null, fallback: false })
        packHtmlPreview(props.text, props.path, props.sessionId, controller.signal)
          .then(function (bundle) {
            if (controller.signal.aborted) return
            // 本地依赖改为内联到 srcDoc。实际 Desktop WebView 中 blob: 沙箱会
            // 让 Three.js 这类多 classic-script + WebGL 页面白屏；内联保留脚本
            // 的 parser 顺序，并仍不暴露父页/同源能力。
            setFrame({ key: key, url: inlinePackedHtml(bundle), fallback: true })
          })
          .catch(function () {
            // Blob 导航受宿主 CSP 等环境因素影响时，保留旧 srcDoc 路径，
            // 不能让增强渲染反而导致普通 HTML 无法打开。
            if (!controller.signal.aborted) setFrame({ key: key, url: null, fallback: true })
          })
        return function () {
          controller.abort()
          if (url) URL.revokeObjectURL(url)
        }
      }, [key, props.path, props.sessionId])
      if (frame.key !== key || (!frame.url && !frame.fallback)) return create('div', { className: 'dfv-muted' }, '正在加载 HTML 预览…')
      if (frame.fallback) return create('iframe', {
        className: 'dfv-frame',
        sandbox: 'allow-scripts allow-popups allow-forms allow-modals',
        referrerPolicy: 'no-referrer', title: props.title || T('files.htmlFrame'),
        srcDoc: frame.url || prepareHtmlText(props.text), 'data-html-preview-fallback': true,
      })
      return create('iframe', {
        className: 'dfv-frame', sandbox: 'allow-scripts allow-popups allow-forms allow-modals', referrerPolicy: 'no-referrer',
        title: props.title || T('files.htmlFrame'), src: frame.url, 'data-html-preview': true,
      }, frame.url)
    }

    function PdfPreview(props) {
      // 对齐 JupyterLab pdf-extension：base64 → Blob → objectURL → 原生查看器
      // 嵌入（object 标签）。不加 sandbox——渲染方是浏览器自带的受信 PDF 查看器。
      var st = React.useState({ url: null, error: '' })
      var state = st[0]
      var setSt = st[1]
      React.useEffect(function () {
        var cancelled = false
        var made = null
        fetch('data:application/pdf;base64,' + props.data)
          .then(function (r) { return r.blob() })
          .then(function (blob) {
            if (cancelled) { URL.revokeObjectURL(made); return }
            made = URL.createObjectURL(blob)
            setSt({ url: made, error: '' })
          })
          .catch(function (e) {
            if (!cancelled) setSt({ url: null, error: String((e && e.message) || e) })
          })
        return function () {
          cancelled = true
          if (made) URL.revokeObjectURL(made)
        }
      }, [props.data])
      if (state.error) return create('div', { className: 'dfv-error' }, T('files.pdfFail', { reason: state.error }))
      if (!state.url) return create('div', { className: 'dfv-empty' }, T('files.pdfLoading'))
      return create('object', {
        className: 'dfv-frame dfv-pdf',
        type: 'application/pdf',
        data: state.url,
        'aria-label': T('files.pdfFrame'),
      }, T('files.pdfUnsupported'))
    }

    // ------------------------------------------------------------------
    // Notebook（.ipynb）静态预览，GitHub 风格：markdown 单元走 MarkdownText，
    // 代码单元走 CodeBlock；输出按 MIME 择优渲染（image > html > md > text）。
    // 输出 HTML 与文件 HTML 同规——无 allow-* 沙箱 iframe 禁脚本防注入。
    // ------------------------------------------------------------------
    /** notebook 的 source 字段是 string 或行数组，统一成字符串。 */
    function nbSource(src) {
      return Array.isArray(src) ? src.join('') : String(src == null ? '' : src)
    }

    /** 剥离 traceback 里的 ANSI 转义序列。 */
    function stripAnsi(s) {
      return String(s == null ? '' : s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    }

    var NB_MIME_PREF = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'text/html', 'text/markdown', 'text/latex', 'text/plain']

    function nbPickMime(data) {
      if (!data) return null
      for (var i = 0; i < NB_MIME_PREF.length; i++) {
        if (Object.prototype.hasOwnProperty.call(data, NB_MIME_PREF[i])) return NB_MIME_PREF[i]
      }
      return null
    }

    /** 内核语言名 → Shiki 提示；未知语言由 CodeBlock 自动回退纯文本。 */
    var NB_LANG_HINT = { python: 'py', r: 'r', julia: 'julia', javascript: 'js', typescript: 'ts', bash: 'sh', ruby: 'rb' }

    function NbOutput(props) {
      var out = props.out
      var t = out && out.output_type
      if (t === 'stream') {
        return create('pre', { className: 'dfv-nb-out' + (out.name === 'stderr' ? ' dfv-nb-out-err' : '') }, nbSource(out.text))
      }
      if (t === 'error') {
        var tb = (Array.isArray(out.traceback) ? out.traceback : []).map(stripAnsi).join('\n')
        return create('div', { className: 'dfv-nb-error' },
          create('div', { className: 'dfv-nb-error-head' }, stripAnsi(out.ename) + ': ' + stripAnsi(out.evalue)),
          tb ? create('pre', { className: 'dfv-nb-trace' }, tb) : null)
      }
      if (t === 'execute_result' || t === 'display_data') {
        var mime = nbPickMime(out.data)
        if (!mime) return null
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
          return create('img', { className: 'dfv-nb-img', src: 'data:' + mime + ';base64,' + out.data[mime], alt: 'notebook output image' })
        }
        if (mime === 'image/svg+xml') {
          return create('img', { className: 'dfv-nb-img', src: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(nbSource(out.data[mime])))), alt: 'notebook output svg' })
        }
        if (mime === 'text/html') {
          return create('iframe', { className: 'dfv-nb-html', sandbox: '', title: T('files.nbHtmlOut'), srcDoc: nbSource(out.data[mime]) })
        }
        if (mime === 'text/markdown' && MarkdownText) {
          return create('div', { className: 'dfv-md-wrap dfv-nb-md' }, create(MarkdownText, { text: nbSource(out.data[mime]) }))
        }
        var plain = Object.prototype.hasOwnProperty.call(out.data || {}, 'text/plain') ? out.data['text/plain'] : out.data[mime]
        return create('pre', { className: 'dfv-nb-out' }, nbSource(plain))
      }
      return null
    }

    function NotebookPreview(props) {
      var nb = null
      try { nb = JSON.parse(props.text) } catch (err) { nb = undefined }
      if (nb === undefined || typeof nb !== 'object' || nb === null) {
        return create(React.Fragment, null,
          create('div', { className: 'dfv-cap' }, T('files.nbFail')),
          create('pre', { className: 'dfv-code' }, props.text))
      }
      var cells = Array.isArray(nb.cells) ? nb.cells : []
      if (!cells.length && Array.isArray(nb.worksheets)) {
        // nbformat v3：worksheets[].cells 扁平合并
        for (var w = 0; w < nb.worksheets.length; w++) {
          cells = cells.concat(Array.isArray(nb.worksheets[w].cells) ? nb.worksheets[w].cells : [])
        }
      }
      var ks = nb.metadata && nb.metadata.kernelspec
      var kernelName = (ks && (ks.display_name || ks.name)) || ''
      var langName = nb.metadata && nb.metadata.language_info && nb.metadata.language_info.name
      var codeLang = (langName && Object.prototype.hasOwnProperty.call(NB_LANG_HINT, String(langName).toLowerCase()))
        ? NB_LANG_HINT[String(langName).toLowerCase()]
        : undefined

      var cellEls = cells.map(function (cell, i) {
        var ct = cell.cell_type
        var body = null
        if (ct === 'code') {
          var outputs = (Array.isArray(cell.outputs) ? cell.outputs : []).map(function (o, j) {
            return create(NbOutput, { key: j, out: o })
          })
          var codeSrc = nbSource(cell.source)
          body = create('div', { className: 'dfv-nb-cellbody' },
            create(CodeWithLines, { text: codeSrc },
              CodeBlock
                ? create(CodeBlock, { code: codeSrc, lang: codeLang })
                : create('pre', { className: 'dfv-code' }, codeSrc)),
            outputs.length ? create('div', { className: 'dfv-nb-outputs' }, outputs) : null)
        } else if (ct === 'markdown') {
          body = MarkdownText
            ? create('div', { className: 'dfv-md-wrap dfv-nb-cellbody' }, create(MarkdownText, { text: nbSource(cell.source) }))
            : create('pre', { className: 'dfv-code dfv-nb-cellbody' }, nbSource(cell.source))
        } else {
          body = create('pre', { className: 'dfv-code dfv-nb-cellbody dfv-nb-raw' }, nbSource(cell.source))
        }
        var badge = ct === 'code'
          ? '[' + (cell.execution_count != null ? cell.execution_count : ' ') + ']'
          : ct === 'markdown' ? 'Md' : 'raw'
        return create('div', { key: i, className: 'dfv-nb-cell dfv-nb-' + ct },
          create('div', { className: 'dfv-nb-gutter' }, badge),
          body)
      })

      return create('div', { className: 'dfv-nb' },
        create('div', { className: 'dfv-cap' },
          'Jupyter Notebook' + (kernelName ? ' · ' + kernelName : '') + ' · ' + T('files.nbCells', { n: cells.length })),
        cellEls.length ? cellEls : create('div', { className: 'dfv-muted' }, T('files.nbEmpty')))
    }

    function JsonPreview(props) {
      var failed = false
      try { JSON.parse(props.text) } catch (err) { failed = true }
      if (failed) {
        return create(React.Fragment, null,
          create('div', { className: 'dfv-cap' }, T('files.jsonFail')),
          create('pre', { className: 'dfv-code' }, props.text))
      }
      return create('pre', { className: 'dfv-json dfv-code' }, jsonColorNodes(JSON.stringify(JSON.parse(props.text), null, 2)))
    }

    function DelimitedPreview(props) {
      var delim = props.delim || ','
      var rows = parseDelimited(props.text, delim)
      var totalRows = rows.length
      // 首行作表头（数据导出的常见约定）
      var headerCells = totalRows > 0 ? rows[0].slice(0, CSV_MAX_COLS) : []
      var cols = headerCells.length
      for (var r = 1; r <= Math.min(totalRows - 1, CSV_MAX_ROWS); r++) {
        cols = Math.max(cols, Math.min(rows[r].length, CSV_MAX_COLS))
      }
      var caps = []
      if (totalRows > CSV_MAX_ROWS + 1) caps.push(T('files.csvTruncated', { total: totalRows, n: CSV_MAX_ROWS }))
      var trs = []
      for (var ri = 1; ri <= Math.min(totalRows - 1, CSV_MAX_ROWS); ri++) {
        var cells = rows[ri]
        var tds = []
        for (var c = 0; c < cols; c++) {
          tds.push(create('td', { key: c, className: 'dfv-td' }, cells[c] != null ? String(cells[c]) : ''))
        }
        trs.push(create('tr', { key: ri }, tds))
      }
      return create(React.Fragment, null,
        caps.length ? create('div', { className: 'dfv-cap' }, caps.join('；')) : null,
        create('div', { className: 'dfv-table-wrap' },
          create('table', { className: 'dfv-table' },
            create('thead', null,
              create('tr', null, headerCells.map(function (cellText, ci) {
                return create('th', { key: ci, className: 'dfv-th' }, cellText != null ? String(cellText) : '')
              })),
            ),
            create('tbody', null, trs),
          ),
        ),
      )
    }

    function formatBytes(n) {
      if (typeof n !== 'number' || n < 0) return ''
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(1) + ' GB'
    }

    /** 代码内容 + 左侧行号列（源码文件 / notebook code cell 用）。 */
    function CodeWithLines(props) {
      var text = props.text || ''
      var lineCount = text.split('\n').length
      var nums = []
      for (var i = 1; i <= lineCount; i++) nums.push(create('div', { key: i }, String(i)))
      return create('div', { className: 'dfv-code-lines' },
        create('div', { className: 'dfv-code-gutter', 'aria-hidden': true }, nums),
        create('div', { className: 'dfv-code-main' }, props.children),
      )
    }

    function FileContent(props) {
      var entry = props.entry
      if (entry.loading) {
        return create('div', { className: 'dfv-empty' }, T('files.loading'))
      }
      if (entry.error) {
        return create('div', { className: 'dfv-error' }, entry.error)
      }
      if (entry.kind === 'binary') {
        return create('div', { className: 'dfv-muted' },
          T('files.binary', { size: formatBytes(entry.size) }))
      }
      if (entry.kind === 'image-too-large') {
        return create('div', { className: 'dfv-muted' },
          T('files.imageTooLarge', { size: formatBytes(entry.size), limit: formatBytes(entry.limit) }))
      }
      if (entry.kind === 'image') {
        return create('div', { className: 'dfv-image-wrap' },
          create('img', { className: 'dfv-image', src: entry.dataUrl, alt: entry.name }))
      }
      if (entry.kind === 'pdf-too-large') {
        return create('div', { className: 'dfv-muted' },
          T('files.pdfTooLarge', { size: formatBytes(entry.size), limit: formatBytes(entry.limit) }))
      }
      if (entry.kind === 'pdf') {
        return create(PdfPreview, { data: entry.data })
      }
      if (entry.editing) return create(TextEditor, { entry: entry })
      // 文本类：按扩展名选预览渲染器；编辑态返回预览时展示当前草稿
      var text = entry.dirty ? entry.draft : entry.content
      var pk = previewKind(entry.path)
      var view = null
      if (pk === 'markdown') view = create(MarkdownPreview, { text: text, baseDir: parentOf(entry.path) })
      else if (pk === 'html') view = create(HtmlPreview, {
        text: text, path: entry.path, sessionId: activeSessionId, title: entry.name,
      })
      else if (pk === 'json') view = create(CodeWithLines, { text: text }, create(JsonPreview, { text: text }))
      else if (pk === 'notebook') view = create(NotebookPreview, { text: text })
      else if (pk === 'csv' || pk === 'tsv') view = create(DelimitedPreview, { text: text, delim: pk === 'tsv' ? '\t' : ',' })
      else {
        // 代码文件：DSH CodeBlock（Shiki 高亮，语法包懒加载）；无高亮条件回退纯文本
        // 都包在 CodeWithLines 里加左侧行号
        var lang = Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, extOfName(entry.path))
          ? CODE_LANG_BY_EXT[extOfName(entry.path)]
          : undefined
        var codeEl = (CodeBlock && lang && text.length <= CODE_HIGHLIGHT_MAX_CHARS)
          ? create(CodeBlock, { code: text, lang: lang })
          : create('pre', { className: 'dfv-code' }, text)
        view = create(CodeWithLines, { text: text }, codeEl)
      }
      return create(React.Fragment, null,
        entry.truncated ? create('div', { className: 'dfv-cap' },
          T('files.truncated')) : null,
        view,
      )
    }

    function FileToolbar(props) {
      var active = props.entry
      var buttons = []
      if (active.loaded && active.kind === 'text' && isEditableTextFile(active.path)) {
        if (!active.editing) {
          buttons.push(create('button', {
            type: 'button',
            className: 'dfv-btn',
            title: T('files.editTitle'),
            disabled: active.truncated,
            onClick: function () { startEditing(active.path) },
          },
            create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: FILE_ICON_EDIT } }),
            T('files.edit'),
          ))
        } else {
          buttons.push(create('button', {
            type: 'button',
            className: 'dfv-btn',
            title: T('files.previewTitle'),
            onClick: function () { stopEditing(active.path) },
          },
            create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: FILE_ICON_PREVIEW } }),
            T('files.preview'),
          ))
        }
      }
      buttons.push(active.loaded ? create('button', {
        type: 'button',
        className: 'dfv-btn',
        title: T('files.reloadTitle'),
        onClick: function () { reloadFile(active.path) },
      },
        create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }),
        T('files.reload'),
      ) : null)
      return create(React.Fragment, null,
        create('span', { className: 'dfv-toolbar-path', title: active.path }, active.path),
        typeof active.size === 'number' && active.size > 0 ? create('span', null, formatBytes(active.size)) : null,
        active.saving ? create('span', { className: 'dfv-status' }, T('files.saving')) : null,
        active.justSaved && !active.saving && !active.dirty ? create('span', { className: 'dfv-status dfv-saved' }, T('files.saved')) : null,
        active.conflict ? create('span', { className: 'dfv-status', title: T('files.conflict') }, T('files.conflictShort')) : null,
        active.saveError ? create('span', { className: 'dfv-save-error', title: active.saveError }, active.saveError) : null,
        buttons,
      )
    }

    /**
     * 纯阅读模式标记：在会话根（含 composerSeat 的最近祖先，即 DSH
     * ConversationRoot 的 root 节点）上打 data-dsh-soup-preview，由上面
     * 注入的 CSS 隐藏输入区与轮次统计行。DSH 重渲染可能重建该节点——
     * MutationObserver 在 FilesView 存活期间持续确保标记存在。
     */
    function usePreviewReadingMode(rootRef) {
      React.useEffect(function () {
        var observer = null
        var marked = null
        document.body.classList.add('dsh-soup-preview-active')
        function apply() {
          var el = rootRef.current
          if (!el) return
          if (marked && marked.contains(el) && marked.getAttribute('data-dsh-soup-preview') === '1') return
          var host = el.parentElement
          while (host) {
            if (host.querySelector && (host.querySelector('[data-composer-seat]') || host.querySelector('.wSkVaW_composerSeat'))) break
            host = host.parentElement
          }
          if (!host) return
          host.setAttribute('data-dsh-soup-preview', '1')
          marked = host
        }
        apply()
        observer = new MutationObserver(function () { apply() })
        observer.observe(document.body, { childList: true, subtree: true })
        return function () {
          if (observer) observer.disconnect()
          if (marked) marked.removeAttribute('data-dsh-soup-preview')
          document.body.classList.remove('dsh-soup-preview-active')
          marked = null
        }
      }, [])
    }

    function FilesView(props) {
      var s = useStore()
      var files = s.files
      var active = files.active ? findFileEntry(files.active) : null
      var rootRef = React.useRef(null)
      usePreviewReadingMode(rootRef)

      var tabs = files.list.map(function (entry) {
        return create('button', {
          key: entry.path,
          type: 'button',
          className: 'dfv-tab' + (files.active === entry.path ? ' active' : ''),
          title: entry.path,
          onClick: function () { setActiveFile(entry.path) },
        },
          entry.dirty ? create('span', { className: 'dfv-dirty', title: T('files.unsaved') }) : null,
          create('span', { className: 'dfv-tab-name' }, entry.name),
          create('span', {
            className: 'dfv-close',
            role: 'button',
            title: T('explorer.close'),
            onClick: function (e) { e.stopPropagation(); closeFileTab(entry.path) },
          }, '✕'),
        )
      })

      var toolbar = null
      var body = null
      if (!active) {
        body = create('div', { className: 'dfv-empty' },
          create('span', { style: { fontSize: 22 } }, '📄'),
          T('files.emptyHint'),
        )
      } else {
        toolbar = create('div', { className: 'dfv-toolbar' },
          create(FileToolbar, { entry: active }),
          create('button', {
            type: 'button',
            className: 'dfv-btn',
            title: '最大化', 'aria-label': '最大化',
            onClick: function () { setFiles({ overlay: true, overlayMax: true, overlayReturn: 'tab' }) },
            dangerouslySetInnerHTML: { __html: EXPAND_SVG },
          }),
        )
        body = create('div', { className: 'dfv-body' },
          create(FileContent, { key: active.path, entry: active }),
        )
      }

      return create('div', { className: 'dfv-root', ref: rootRef },
        files.list.length > 0 ? create('div', { className: 'dfv-header' },
          create('div', { className: 'dfv-tabbar' }, tabs),
          toolbar,
        ) : null,
        body,
      )
    }

    /** 空会话兜底浮层：原生 tab 条不存在时以模态渲染 FileContent。 */
    function PreviewOverlay() {
      var s = useStore()
      var files = s.files
      if (!files.overlay || !files.active) return null
      var active = findFileEntry(files.active)
      if (!active) return null
      var close = function () { setFiles({ overlay: false, overlayMax: false, overlayReturn: null }) }
      var closeAndCloseTab = function () {
        if (active.dirty && typeof window !== 'undefined' && !window.confirm(T('files.unsavedConfirm'))) return
        close()
        closeFileTab(active.path)
      }
      var toggleMax = function () {
        if (files.overlayMax && files.overlayReturn === 'tab') {
          // 还原 → 回到 tab 模式
          close()
        } else {
          setFiles({ overlayMax: !files.overlayMax })
        }
      }
      return create('div', {
        className: 'dfv-overlay',
        onClick: function (e) { if (e.target === e.currentTarget) close() },
      },
        create('div', { className: 'dfv-overlay-panel' + (files.overlayMax ? ' dfv-overlay-max' : '') },
          create('div', { className: 'dfv-toolbar' },
            create(FileToolbar, { entry: active }),
            create('button', {
              type: 'button', className: 'dfv-overlay-close',
              title: files.overlayMax ? '还原' : '最大化', 'aria-label': files.overlayMax ? '还原' : '最大化',
              onClick: toggleMax,
              dangerouslySetInnerHTML: { __html: files.overlayMax ? SHRINK_SVG : EXPAND_SVG },
            }),
            create('button', {
              type: 'button', className: 'dfv-overlay-close',
              title: files.overlayReturn === 'tab' ? '关闭预览 tab' : '关闭',
              'aria-label': files.overlayReturn === 'tab' ? '关闭预览 tab' : '关闭',
              onClick: closeAndCloseTab,
            }, '✕'),
          ),
          create(FileContent, { key: active.path, entry: active }),
        ),
      )
    }

    function findFrameEl(startEl) {
      var cur = startEl && startEl.parentElement
      while (cur) {
        try {
          var gtc = cur.style && cur.style.gridTemplateColumns
          if (gtc && gtc.indexOf('1fr') !== -1) return cur
        } catch (e) {}
        cur = cur.parentElement
      }
      return null
    }

    function setHeroDetailsWidth(startEl, width) {
      var frame = findFrameEl(startEl)
      if (!frame) return false
      try {
        var gtc = frame.style.gridTemplateColumns
        if (!gtc) return false
        var parts = gtc.trim().split(/\s+/)
        if (parts.length < 3) return false
        parts[parts.length - 1] = width + 'px'
        frame.style.gridTemplateColumns = parts.join(' ')
        return true
      } catch (e) {
        return false
      }
    }

    // ------------------------------------------------------------------
    // ▓▓ 区域三 · 速率徽标 · 🧂 盐
    //   输入框上方实时 t/s 吞吐徽标，数据来自 llm/stream 真实流；timerRef 为共享模块级计时引用。
    // ------------------------------------------------------------------
    // 速度徽标：DOM 注入到 Deep diving（role=status）旁。
    // 不改 DSH 源码。用 MutationObserver 定位消息流里的 Deep diving，
    // 把徽标节点 append 进其行内（inline-flex 同行），实现永远紧贴。
    // ------------------------------------------------------------------
    // 模块级 timer 引用：apply(ctx) 里赋值（与 dsh-soup 现有 layout 同款模式）
    var timerRef = null

    function SpeedBadge(props) {
      var sessionId = props && (props.sessionId || (props.session && (props.session.sessionId || props.session.id)))

      // 持有最新状态的最新值的 ref（供 MutationObserver 回调读取）
      var statusRef = React.useRef(null)
      var dotsRef = React.useRef(1)
      var badgeElRef = React.useRef(null)
      // hostRef：当前挂载的 Deep diving 宿主元素（observer 找到后持有）
      var hostRef = React.useRef(null)

      // 省略号循环
      React.useEffect(function () {
        if (!timerRef) return
        var stop = timerRef.interval(function () {
          dotsRef.current = dotsRef.current >= 3 ? 1 : dotsRef.current + 1
          if (hostRef.current) renderBadge()
        }, 400)
        return function () { stop() }
      }, [])

      // 速度轮询
      React.useEffect(function () {
        if (!sessionId || !timerRef) return
        var cancelled = false
        var poll = function () {
          rpc('speed-status', { sessionId: sessionId }).then(function (res) {
            if (!cancelled && res && res.ok) {
              statusRef.current = res
              if (hostRef.current) renderBadge()
            }
          }).catch(function () {})
        }
        poll()
        var stop = timerRef.interval(poll, 300)
        return function () { cancelled = true; stop() }
      }, [sessionId])

      // 渲染徽标内容到 badgeEl（由需要时调用；这里用函数声明提升，需放在 effect 外）
      function renderBadge() {
        var el = badgeElRef.current
        if (!el) return
        var st = statusRef.current
        // 清空
        while (el.firstChild) el.removeChild(el.firstChild)
        if (!st || st.phase === 'idle' || st.phase === 'done') {
          el.style.display = 'none'
          return
        }
        el.style.display = 'inline-flex'
        if (st.phase === 'waiting') {
          // 宿主 .turnStatus 用 background-clip:text + 渐变透明色，内部子元素
          // 会继承 text-fill-color 而把颜色冲成渐变；必须 important 覆盖。
          el.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;font-weight:400;font-size:13px;color:var(--dsw-alias-label-caption);'
          el.style.setProperty('color', 'var(--dsw-alias-label-caption)', 'important')
          el.style.setProperty('-webkit-text-fill-color', 'var(--dsw-alias-label-caption)', 'important')
          el.textContent = T('speed.waiting') + new Array(dotsRef.current + 1).join('.')
          return
        }
        // 流式阶段：token 计数立即显示；瞬时速率窗口未满（tps=0）时先不显示徽标，
        // 而不是回退到「正在等待模型」（否则短输出全程都显示等待）。
        var tps = st.tps || 0
        var bg = tps >= 50 ? '#53b3cb' : tps >= 30 ? '#9bc53d' : tps >= 15 ? '#f9c22e' : '#e01a4f'
        el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:10px;font-weight:400;font-size:11px;color:var(--dsw-alias-label-primary);-webkit-text-fill-color:var(--dsw-alias-label-primary);'
        var tok = document.createElement('span')
        tok.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);'
        var SVG = 'http://www.w3.org/2000/svg'
        var svg = document.createElementNS(SVG, 'svg')
        svg.setAttribute('width', '10'); svg.setAttribute('height', '10'); svg.setAttribute('viewBox', '0 0 10 10')
        svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.2')
        svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
        var ln = document.createElementNS(SVG, 'line'); ln.setAttribute('x1', '5'); ln.setAttribute('y1', '1.5'); ln.setAttribute('x2', '5'); ln.setAttribute('y2', '8.5'); svg.appendChild(ln)
        var poly = document.createElementNS(SVG, 'polyline'); poly.setAttribute('points', '2 6 5 8.5 8 6'); svg.appendChild(poly)
        tok.appendChild(svg)
        tok.appendChild(document.createTextNode(String(Math.round(st.tokens))))
        el.appendChild(tok)
        if (tps > 0) {
          var pill = document.createElement('span')
          pill.style.cssText = 'margin-left:6px;padding:1px 6px;border-radius:4px;background:' + bg + ';color:#fff;-webkit-text-fill-color:#fff;font-size:11px;font-weight:500;'
          pill.textContent = tps.toFixed(1) + ' t/s'
          el.appendChild(pill)
        }
      }

      // MutationObserver：定位 Deep diving 并把 badgeEl 挂进去
      React.useEffect(function () {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
        // 初始化徽标 DOM 节点
        if (badgeElRef.current === null) {
          badgeElRef.current = document.createElement('span')
          badgeElRef.current.setAttribute('data-dsh-speed-badge', '')
          badgeElRef.current.style.display = 'none'
        }
        var badge = badgeElRef.current

        function findTurnStatus() {
          var candidates = document.querySelectorAll('[data-chat-flow] [role="status"], [data-chat-flow] [aria-live="polite"]')
          for (var i = 0; i < candidates.length; i++) {
            var text = candidates[i].textContent || ''
            // DSH i18n（locale chat.deepDiving）：英文 'Deep diving...' / 中文 '深度求索中...'
            if (text.indexOf('Deep diving') !== -1 || text.indexOf('深度求索') !== -1) return candidates[i]
          }
          return null
        }

        function attach() {
          // 已挂载且宿主仍在 DOM 中时无需重复查找：徽标内容由 timer/poll 驱动
          // renderBadge 更新，observer 只负责把徽标挂进/移出宿主元素。
          if (hostRef.current && hostRef.current.isConnected) {
            // 若 DSH 在徽标之后又追加了子元素（如 15s 后的 elapsed clock），
            // 把徽标移到末尾，让它始终紧跟 Deep diving 的计时。
            if (badge.parentNode !== hostRef.current || hostRef.current.lastElementChild !== badge) {
              try { hostRef.current.appendChild(badge) } catch (e) {}
            }
            return
          }
          var target = findTurnStatus()
          if (target !== null) {
            hostRef.current = target
            if (badge.parentNode !== target) { try { target.appendChild(badge) } catch (e) {} }
            renderBadge()
          } else if (hostRef.current !== null) {
            if (badge.parentNode) { try { badge.parentNode.removeChild(badge) } catch (e) {} }
            hostRef.current = null
          }
        }

        var mo = new MutationObserver(function () { attach() })
        mo.observe(document.body, { childList: true, subtree: true })
        attach()
        return function () {
          mo.disconnect()
          if (badge.parentNode) { try { badge.parentNode.removeChild(badge) } catch (e) {} }
          hostRef.current = null
        }
      }, [])

      return null
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域四 · 多行 GoalBar · 🧄 蒜
    //   复用原生 goal projection 与动作动词，多行完整展示 + textarea 编辑。
    // ------------------------------------------------------------------
    // GoalBar 多行版：复用 DSH 原生 GoalBar 的 goal projection 与动作动词
    // （onEdit/onPause/onResume/onClear），仅在展示上把单行截断放开为多行、
    // 编辑用 textarea。通过 conversation.input.dock 同 id 'goal' + 更低 priority
    // (-1 < 0) 遮蔽默认实现，不改 DSH 源码，工具与数据仍走原生 goal。
    // ------------------------------------------------------------------
    var GOAL_PHASE_LABELS = {
      active: 'phase.active',
      paused: 'phase.paused',
      blocked: 'phase.blocked',
    }

    function goalIcon(children) {
      return create('svg', {
        width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true,
      }, children)
    }

    var ICON_GOAL = goalIcon([
      create('circle', { key: 'a', cx: '12', cy: '12', r: '10' }),
      create('circle', { key: 'b', cx: '12', cy: '12', r: '6' }),
      create('circle', { key: 'c', cx: '12', cy: '12', r: '2', fill: 'currentColor', stroke: 'none' }),
    ])
    var ICON_PAUSE = goalIcon([
      create('rect', { key: 'a', x: '6', y: '4', width: '4', height: '16', rx: '1', fill: 'currentColor', stroke: 'none' }),
      create('rect', { key: 'b', x: '14', y: '4', width: '4', height: '16', rx: '1', fill: 'currentColor', stroke: 'none' }),
    ])
    var ICON_PLAY = goalIcon([
      create('path', { key: 'p', d: 'M6 4l14 8-14 8V4z', fill: 'currentColor', stroke: 'none' }),
    ])
    var ICON_EDIT = goalIcon([
      create('path', { key: 'a', d: 'M12 20h9' }),
      create('path', { key: 'b', d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }),
    ])
    var ICON_CHECK = goalIcon([
      create('polyline', { key: 'a', points: '20 6 9 17 4 12' }),
    ])
    var ICON_CLOSE = goalIcon([
      create('line', { key: 'a', x1: '18', y1: '6', x2: '6', y2: '18' }),
      create('line', { key: 'b', x1: '6', y1: '6', x2: '18', y2: '18' }),
    ])
    var ICON_TRASH = goalIcon([
      create('polyline', { key: 'a', points: '3 6 5 6 21 6' }),
      create('path', { key: 'b', d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
      create('path', { key: 'c', d: 'M10 11v6' }),
      create('path', { key: 'd', d: 'M14 11v6' }),
      create('path', { key: 'e', d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }),
    ])

    function GoalBar(props) {
      var goal = props.goal
      var roundsStarted = props.roundsStarted
      var onEdit = props.onEdit
      var onPause = props.onPause
      var onResume = props.onResume
      var onClear = props.onClear
      var t = props.t || function (k) { return k }

      var editing = React.useState(false)
      var draft = React.useState('')
      var pending = React.useState(false)
      var actionError = React.useState(null)
      var clearedGoalId = React.useState(null)
      var pendingRef = React.useRef(false)
      var textareaRef = React.useRef(null)

      var goalId = goal ? goal.id : undefined
      React.useEffect(function () {
        editing[1](false)
        actionError[1](null)
        clearedGoalId[1](null)
      }, [goalId])

      React.useEffect(function () {
        var input = textareaRef.current
        if (!input) return
        input.style.height = 'auto'
        input.style.height = Math.max(64, input.scrollHeight) + 'px'
      }, [draft[0], editing[0]])

      function runAction(action) {
        if (pendingRef.current) return Promise.resolve(undefined)
        pendingRef.current = true
        pending[1](true)
        actionError[1](null)
        return Promise.resolve().then(function () { return action() }).then(function (result) {
          pendingRef.current = false
          pending[1](false)
          if (!result || !result.ok) {
            var err = result && result.error ? (result.error.message + ' (' + result.error.code + ')') : T('speed.operateFail')
            actionError[1](err)
          }
          return result
        }).catch(function (e) {
          pendingRef.current = false
          pending[1](false)
          actionError[1](String((e && e.message) || e))
        })
      }

      function handleSave() {
        var trimmed = draft[0].trim()
        if (trimmed === '') return
        runAction(function () { return onEdit(trimmed) }).then(function (result) {
          if (result && result.ok) {
            editing[1](false)
          }
        })
      }

      function handleClear() {
        if (!goal) return
        var clearedId = goal.id
        runAction(onClear).then(function (result) {
          if (result && result.ok) clearedGoalId[1](clearedId)
        })
      }

      function openEdit() {
        if (!goal) return
        draft[1](goal.objective)
        editing[1](true)
      }

      function iconBtn(label, onClick, iconNode, disabled) {
        return create('button', {
          type: 'button', title: label, 'aria-label': label,
          className: 'dsh-goal-btn', disabled: disabled === true || pending[0],
          onClick: function () { void onClick() },
        }, iconNode)
      }

      if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === clearedGoalId[0]) return null

      if (editing[0]) {
        return create('div', { className: 'dsh-goal-dock', 'data-goal-bar': '' },
          create('div', { className: 'dsh-goal-bar' },
            create('div', { className: 'dsh-goal-head' },
              create('span', { className: 'dsh-goal-glyph' }, ICON_GOAL),
              create('span', { className: 'dsh-goal-label' }, t(GOAL_PHASE_LABELS[goal.phase] || 'phase.active')),
              actionError[0] !== null && create('span', { className: 'dsh-goal-error', role: 'alert' }, actionError[0]),
              create('div', { className: 'dsh-goal-actions' },
                iconBtn(t('action.save'), handleSave, ICON_CHECK, draft[0].trim() === ''),
                iconBtn(t('action.cancel'), function () { editing[1](false) }, ICON_CLOSE),
              ),
            ),
            create('textarea', {
              className: 'dsh-goal-input',
              ref: textareaRef,
              'aria-label': t('objective.aria'),
              value: draft[0],
              autoFocus: true,
              onChange: function (e) { draft[1](e.target.value) },
              onKeyDown: function (e) {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSave() }
                else if (e.key === 'Escape') { e.preventDefault(); editing[1](false) }
              },
            }),
          ),
        )
      }

      var title = goal.phase === 'blocked' && goal.blockedReason ? goal.blockedReason.message : undefined
      var rounds = roundsStarted !== undefined && goal.maxGoalRounds !== undefined
        ? roundsStarted + '/' + goal.maxGoalRounds
        : undefined
      return create('div', { className: 'dsh-goal-dock', 'data-goal-bar': '' },
        create('div', { className: 'dsh-goal-bar', title: title || '' },
          create('div', { className: 'dsh-goal-head' },
              create('span', { className: 'dsh-goal-glyph' }, ICON_GOAL),
              create('span', { className: 'dsh-goal-label' }, t(GOAL_PHASE_LABELS[goal.phase] || 'phase.active')),
              rounds !== undefined && create('span', { className: 'dsh-goal-rounds' }, rounds),
            actionError[0] !== null && create('span', { className: 'dsh-goal-error', role: 'alert' }, actionError[0]),
            create('div', { className: 'dsh-goal-actions' },
              goal.phase === 'active' && iconBtn(t('action.pause'), function () { return runAction(onPause) }, ICON_PAUSE),
              goal.phase === 'paused' && iconBtn(t('action.resume'), function () { return runAction(onResume) }, ICON_PLAY),
              iconBtn(t('action.edit'), openEdit, ICON_EDIT),
              iconBtn(t('action.clear'), handleClear, ICON_TRASH),
            ),
          ),
          create('div', { className: 'dsh-goal-objective' }, goal.objective),
        ),
      )
    }

    function GoalDock(props) {
      var projection = props.useProjection('goal')
      var goal = projection === undefined ? undefined : projection === null ? null : projection.goal
      return create(GoalBar, {
        goal: goal,
        roundsStarted: projection === undefined || projection === null ? undefined : projection.roundsStarted,
        onEdit: props.onEdit,
        onPause: props.onPause,
        onResume: props.onResume,
        onClear: props.onClear,
        t: props.t,
      })
    }

    /** 应用浏览器半区：注册会话头部/空白会话切换按钮、details 右列面板、GoalBar、速度徽标。 */
    // ------------------------------------------------------------------
    // ▓▓ 区域五 · 应用注册（apply）
    //   把上述各区域组件注册进 slots / inject；导出插件浏览器半区入口 apply/inject。
    // ------------------------------------------------------------------
    function apply(ctx) {
      var slots = ctx.slots
      layout = ctx.layout
      timerRef = ctx.timer
      var sessions = ctx.sessions
      var remoteGoals = ctx.remote.goals
      var disposers = []
      // 0.1.5's official Sidebar adds a header-corner expand button. Its
      // default handler opens the official surface, which would diverge from
      // dsh-soup's resource explorer. Route that button to the same layout
      // face used by our explorer controls instead.
      if (typeof document !== 'undefined') {
        var onOfficialExpand = function (event) {
          var target = event.target && event.target.closest
            ? event.target.closest('[data-sidebar-right-expand]') : null
          if (!target) return
          event.preventDefault()
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
          else event.stopPropagation()
          try {
            if (state.open) {
              if (layout && typeof layout.closeRightbar === 'function') layout.closeRightbar()
              else if (layout && typeof layout.closeDetails === 'function') layout.closeDetails()
            } else if (layout && typeof layout.openRightbar === 'function') {
              layout.openRightbar(true, false)
            } else if (layout && typeof layout.openDetails === 'function') layout.openDetails()
          } catch (e) {}
        }
        document.addEventListener('click', onOfficialExpand, true)
        disposers.push(function () { document.removeEventListener('click', onOfficialExpand, true) })
      }
      // 官方产物链接桥接：包装 sidebarRight 服务（见 parseFileAddress 处注释）。
      // 优先走可选注入的 ctx.sidebarRight（框架保证就绪），并保留
      // ctx.get / ctx.reflect.get 多条解析路径与短轮询兜底。
      var bridgePatched = false
      function resolveSidebarRight() {
        try { if (ctx.sidebarRight) return ctx.sidebarRight } catch (e) {}
        try {
          if (typeof ctx.get === 'function') {
            var viaGet = ctx.get('sidebarRight', false)
            if (viaGet) return viaGet
          }
        } catch (e) {}
        try {
          if (ctx.reflect && typeof ctx.reflect.get === 'function') {
            var viaReflect = ctx.reflect.get('sidebarRight', false)
            if (viaReflect) return viaReflect
          }
        } catch (e) {}
        return null
      }
      function patchSidebarRightBridge() {
        if (bridgePatched) return true
        var service = resolveSidebarRight()
        if (!service || typeof service.openResource !== 'function') return false
        if (!service.__dshSoupFileBridge) {
          var origResource = service.openResource
          var origResourceIn = service.openResourceIn
          service.openResource = function (address, options) {
            if (fileAddressMatches(address, null)) { openFileAddressInSoup(address, null); return }
            return origResource.call(service, address, options)
          }
          if (typeof origResourceIn === 'function') {
            service.openResourceIn = function (sessionId, address, options) {
              if (fileAddressMatches(address, sessionId)) { openFileAddressInSoup(address, sessionId); return }
              return origResourceIn.call(service, sessionId, address, options)
            }
          }
          try { Object.defineProperty(service, '__dshSoupFileBridge', { value: true }) }
          catch (e) { service.__dshSoupFileBridge = true }
        }
        bridgePatched = true
        try { if (typeof window !== 'undefined') window.__DSH_SOUP_FILE_BRIDGE = true } catch (e) {}
        return true
      }
      patchSidebarRightBridge()
      var bridgeTries = 0
      var bridgeTimer = setInterval(function () {
        bridgeTries += 1
        if (patchSidebarRightBridge() || bridgeTries >= 10) clearInterval(bridgeTimer)
      }, 1000)
      disposers.push(function () { clearInterval(bridgeTimer) })
      // i18n：注册双语词典；模块级 T 供组件外回调（菜单/错误横幅）取当前语言文案。
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'dsh-soup: dictionaries')
        if (typeof ctx.locale.bind === 'function') T = ctx.locale.bind(NS)
      }
      // 自动刷新心跳：1s 固定心跳 + 到期才探测（基础 3s；宿主不可达时指数退避，封顶 60s）。
      // 面板关且无预览时 tick 内直接返回（零请求）；首个 tick 只建基线。
      if (timerRef && typeof timerRef.interval === 'function') {
        var stopAuto = timerRef.interval(function () { autoHeartbeat() }, AUTO_HEARTBEAT_MS)
        disposers.push(function () { try { stopAuto() } catch (e) {} })
      }
      slots.inject('conversation.session.header.utilities', function () {
        disposers.push(slots.register(
          { name: 'conversation.session.header.utilities', id: 'dsh-soup-toggle', order: 10, locale: NS, label: function () { return T('explorer.label') } },
          function (props) { return create(HeaderAction, props) },
        ))
      })
      slots.inject('details', function () {
        disposers.push(slots.register(
          // `details` is a single slot occupied by the shell at priority 0.
          // Lower priorities render first, so this intentionally shadows it.
          { name: 'details', priority: -1, locale: NS },
          function (props) {
            return create(React.Fragment, null,
              create(Panel, props),
              create(PreviewOverlay),
            )
          },
        ))
      })
      // DSH 0.1.5 moved the right column from the legacy `details` seat to
      // `rightbar`.  Register at a lower priority so dsh-soup remains the
      // occupant when the official Sidebar plugin is present.
      slots.inject('rightbar', function () {
        disposers.push(slots.register(
          { name: 'rightbar', priority: -1, locale: NS },
          function (props) {
            return create(React.Fragment, null,
              create(Panel, props),
              create(PreviewOverlay),
            )
          },
        ))
      })
      // 文件标签页：与 对话/轨迹 同级的原生 view tab（ui-trajectory 同款注册方式）。
      // 槽位 entry 是静态的，多文件由 FilesView 内部子 tab 条管理。
      slots.inject('conversation.view', function () {
        disposers.push(slots.register(
          { name: 'conversation.view', id: 'dsh-soup-files', order: 20, locale: NS, label: function () { return T('files.tab') } },
          function (props) { return create(FilesView, props) },
        ))
      })
      // 从 goal projection 读取当前 CAS ref（与原生 GoalBar 同款逻辑）。
      function refOf(sessionId) {
        try {
          var binding = sessions.binding(sessionId)
          var face = binding && binding.session && binding.session.projections && binding.session.projections.faceOf('goal')
          var snapshot = face && face.getSnapshot()
          if (snapshot && snapshot.goal) return { id: snapshot.goal.id, revision: snapshot.goal.revision }
        } catch (e) { /* ignore */ }
        return undefined
      }
      var noCurrentGoal = {
        ok: false,
        error: { code: 'no-current-goal', message: 'no current goal to mutate', details: {} },
      }
      slots.inject('conversation.input.dock', function () {
        disposers.push(slots.register(
          { name: 'conversation.input.dock', id: 'dsh-soup-hero-toggle', order: -10, locale: NS },
          function (props) { return create(HeroAction, props) },
        ))
        // GoalBar 多行版：同 id 'goal'、更低 priority (-1) -> 遮蔽默认单行实现。
        // inject 提供 onEdit/onPause/onResume/onClear 动作动词（与原生 GoalBar 一致）。
        disposers.push(slots.register(
          {
            name: 'conversation.input.dock', id: 'goal', order: 10, priority: -1, locale: 'goal',
            inject: function (sessionId) {
              return {
                onEdit: function (objective) {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.edit(sessionId, ref, { objective: objective })
                },
                onPause: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.pause(sessionId, ref)
                },
                onResume: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.resume(sessionId, ref)
                },
                onClear: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.clear(sessionId, ref)
                },
              }
            },
          },
          function (props) { return create(GoalDock, props) },
        ))
        disposers.push(slots.register(
          { name: 'conversation.input.dock', id: 'dsh-speed-badge', order: 30, locale: NS, label: function () { return T('speed.label') } },
          function (props) { return create(SpeedBadge, props) },
        ))
      })
      ctx.effect(
        function () { return function () { disposers.forEach(function (d) { try { d() } catch (e) {} }) } },
        'dsh-soup: explorer toggles + details panel + speed badge',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
