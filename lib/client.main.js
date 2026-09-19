import { injectPluginStyles, ICON_REFRESH, ICON_NEW_FOLDER, ICON_MORE, EXPAND_SVG, SHRINK_SVG } from './client/styles.js'
import { NS, DICT } from './client/i18n.js'
import { iconSvgFor } from './client/file-icons.js'
import { createRpc, hostBase } from './client/rpc.js'
import { createHtmlPreview } from './client/html-preview.js'
import { parseFileAddress, fileAddressMatches } from './client/file-address.js'
import { createPreviewRenderers, isEditableTextFile } from './client/preview-renderers.js'
import { createSpeedBadge } from './client/speed-badge.js'
import { createGoalBar } from './client/goal-bar.js'
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

    // Hook 规则安全兜底：宿主未注入 useSessions 时也必须调用恰好一个 hook，
    // 否则 props.useSessions 在两次渲染间从无到有会触发 React #62（渲染期
    // hook 数量不一致），导致 rightbar 入口崩溃让位、回落到官方面板。
    function noopSubscribe() { return function () {} }
    function undefinedSnapshot() { return undefined }

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
    // 与宿主通信：POST /api/dsh-soup（实现在 client/rpc.js；T 由 apply 里
    // 的 locale.bind 重新赋值，因此必须经包装函数取当前值）
    // ------------------------------------------------------------------
    var rpc = createRpc({ translate: function (key, params) { return T(key, params) } })

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
      }) : React.useSyncExternalStore(noopSubscribe, undefinedSnapshot)
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
      }) : React.useSyncExternalStore(noopSubscribe, undefinedSnapshot)
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
      }) : React.useSyncExternalStore(noopSubscribe, undefinedSnapshot)
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
            } else {
              // 新版宿主在右栏关闭时仍保留三轨网格（末轨 360px），但右栏表面
              // 并未挂载。只拉宽网格列会得到一条空白列；必须先经 layout 打开
              // 右栏让表面挂载，再回到 dsh-soup 的宽度合同。
              try {
                if (layout && typeof layout.openRightbar === 'function') layout.openRightbar(true, false)
                else if (layout && typeof layout.openDetails === 'function') layout.openDetails()
              } catch (e) {}
              setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)
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
    // 地址解析（parseFileAddress/fileAddressMatches）实现在 client/file-address.js。

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
    //   按扩展名分派 md/html/pdf/notebook/json/csv + 图片/纯文本兜底 + FileContent
    //   + FilesView 子标签条。渲染器实现已拆至 client/preview-renderers.js；
    //   这里持有工厂产物并接上 files tab 的编辑动作。T/rpc 经包装函数注入
    //   以保持 apply 生命周期内 locale 重绑定行为。
    // ------------------------------------------------------------------
    var HtmlPreview = createHtmlPreview({ React: React, create: create, rpc: rpc, translate: function (key, params) { return T(key, params) } })
    var renderers = createPreviewRenderers({
      React: React,
      create: create,
      T: function (key, params) { return T(key, params) },
      cm: {
        EditorView: CMEditorView,
        EditorState: CMEditorState,
        Keymap: CMKeymap,
        Commands: CMCommands,
        Language: CMLanguage,
        HighlightTags: CMHighlightTags,
        Langs: CMLangs,
      },
      MarkdownText: MarkdownText,
      CodeBlock: CodeBlock,
      HtmlPreview: HtmlPreview,
      parentOf: parentOf,
      getActiveSessionId: function () { return activeSessionId },
      updateDraft: updateDraft,
      manuallySaveFile: manuallySaveFile,
      startEditing: startEditing,
      stopEditing: stopEditing,
      reloadFile: reloadFile,
    })
    var TextEditor = renderers.TextEditor
    var FileContent = renderers.FileContent
    var FileToolbar = renderers.FileToolbar

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

    // 速度徽标（区域三 · 🧂 盐）实现在 client/speed-badge.js：DOM 注入到
    // Deep diving（role=status）旁，MutationObserver 紧贴挂载；timerRef 为
    // 共享模块级计时引用（apply 里赋值），经 getter 注入。
    var SpeedBadge = createSpeedBadge({
      React: React,
      T: function (key, params) { return T(key, params) },
      rpc: rpc,
      getTimerRef: function () { return timerRef },
    })

    // ------------------------------------------------------------------
    // ▓▓ 区域四 · 多行 GoalBar · 🧄 蒜
    //   复用原生 goal projection 与动作动词，多行完整展示 + textarea 编辑。
    // ------------------------------------------------------------------
    // GoalBar 多行版：复用 DSH 原生 GoalBar 的 goal projection 与动作动词
    // （onEdit/onPause/onResume/onClear），仅在展示上把单行截断放开为多行、
    // 编辑用 textarea。通过 conversation.input.dock 同 id 'goal' + 更低 priority
    // (-1 < 0) 遮蔽默认实现，不改 DSH 源码，工具与数据仍走原生 goal。
    // ------------------------------------------------------------------
    // 多行 GoalBar（区域四 · 🧄 蒜）实现在 client/goal-bar.js：复用原生
    // goal projection 与动作动词，多行完整展示 + textarea 编辑；经
    // conversation.input.dock 同 id 'goal' + 更低 priority (-1) 遮蔽默认实现。
    var goalParts = createGoalBar({
      React: React,
      create: create,
      T: function (key, params) { return T(key, params) },
    })
    var GoalBar = goalParts.GoalBar
    var GoalDock = goalParts.GoalDock

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
            if (fileAddressMatches(address, null, activeSessionId)) { openFileAddressInSoup(address, null); return }
            return origResource.call(service, address, options)
          }
          if (typeof origResourceIn === 'function') {
            service.openResourceIn = function (sessionId, address, options) {
              if (fileAddressMatches(address, sessionId, activeSessionId)) { openFileAddressInSoup(address, sessionId); return }
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
