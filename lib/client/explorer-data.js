/**
 * 资源管理器数据层（区域一 · 🧅 葱）：树加载/自动刷新/选择/拖拽移动/
 * 上传下载/重命名新建/展开状态记忆。状态本体存宿主 store（state），
 * 经 getState/setState 访问器读写；files 相关动作（预览/自动保存等）由
 * main 以包装函数延迟注入，避免与 files-store 的初始化顺序耦合。
 */
export function createExplorerData(ctx) {
  var T = ctx.T
  var rpc = ctx.rpc
  var setState = ctx.setState
  var getState = ctx.getState
  var getActiveSessionId = ctx.getActiveSessionId
  var setActiveSessionId = ctx.setActiveSessionId
  var visibleRows = ctx.visibleRows
  var pruneFilesToScope = ctx.pruneFilesToScope
  var scheduleAutoSave = ctx.scheduleAutoSave
  var setFiles = ctx.setFiles
  var findFileEntry = ctx.findFileEntry
  var openFileInTab = ctx.openFileInTab
  var askOverwrite = ctx.askOverwrite
    // trackSession() is called by both the hero toggle and the details panel
    // while a blank conversation is mounted. Keep late async responses from an
    // older caller from overwriting the current session's shared store.
    var sessionTrackGeneration = 0

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

    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（共享数据层）
    //   共享 store、/api/dsh-soup RPC、树数据加载/自动刷新、selection、拖拽/上传/下载、类型图标 —— 预览亦复用其中 store/rpc。
    // ------------------------------------------------------------------





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


    async function loadDir(path, attempt) {
      var res = await rpc('list', { path: path, sessionId: getActiveSessionId() })
      // 新会话刚切换时，宿主会话注册表可能尚未纳入其 cwd——稍候重试。
      // 会话 attach（含冷会话持久化读取）可能超过 2s，放宽退避至 6 次 × 1s。
      if ((!res || !res.ok) && /超出允许范围/.test((res && res.error) || '') && (attempt || 0) < 6) {
        await new Promise(function (r) { setTimeout(r, 1000) })
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
      setActiveSessionId(sessionId || null)
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
      var files = pruneFilesToScope(getState().files, cwd)
      lastMtimes = {} // 换了目录，旧 mtime 基线全部作废（首轮 tick 重建基线）
      setState({ cwd: cwd, selected: new Set(), renaming: null, newItem: null, menu: null, error: '', notice: '', files: files })
      var items = await loadDir(cwd)
      if (generation !== sessionTrackGeneration) return
      if (items) setState({ error: '', tree: items })
    }

    async function refresh() {
      if (!getState().cwd) return
      var items = await loadDir(getState().cwd)
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
      if (getState().cwd) paths.push(getState().cwd)
      var walk = function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i]
          if (n.type === 'directory' && n.children != null) {
            paths.push(n.path)
            if (n.open && n.children.length) walk(n.children)
          }
        }
      }
      walk(getState().tree)
      for (var j = 0; j < getState().files.list.length; j++) {
        var e = getState().files.list[j]
        if (e.path && paths.indexOf(e.path) < 0) paths.push(e.path)
      }
      return paths.slice(0, AUTO_WATCH_MAX)
    }

    /** 预览文件在磁盘上变了：静默重读该 entry（不动激活状态、不闪 tab）。 */
    async function silentReloadEntry(entry) {
      var res = await rpc('read', { path: entry.path, sessionId: getActiveSessionId() })
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
      setFiles({ list: getState().files.list.slice() })
    }

    /** 已展开目录的子项变了：重拉该目录（保持展开态）。 */
    async function reloadDirNode(node) {
      var items = await loadDir(node.path)
      if (items) items.forEach(function (c) { c.parent = node })
      node.children = items || []
      node.open = true
      setState({ tree: getState().tree })
    }

    /**
     * 探一轮。返回 'idle'（本轮没发请求）/ true（探测成功）/ false（请求失败）。
     * 只有真正发出去且失败的请求才累积退避；空闲不累积——面板重开时本就有
     * 一次全量 loadDir，无需为"关着的时候宿主是否恢复"操心。
     */
    async function autoRefreshTick() {
      if (autoTicking) return 'idle'
      if (!getState().open && getState().files.list.length === 0) return 'idle'
      // 用户正在操作（重命名/新建/右键菜单）时跳过本轮，避免打断输入
      if (getState().renaming || getState().newItem || getState().menu) return 'idle'
      var paths = collectWatchPaths()
      if (!paths.length) return 'idle'
      autoTicking = true
      try {
        var res = await rpc('mtime', { paths: paths, sessionId: getActiveSessionId() })
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
          if (dp === getState().cwd) { await refresh(); continue }
          var node = findNode(getState().tree, dp)
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
      if (!getState().cwd) return
      await refresh()
    }

    async function toggleNode(node) {
      if (node.type !== 'directory') return
      if (node.children == null) {
        node.loading = true
        setState({ tree: getState().tree })
        var items = await loadDir(node.path)
        node.loading = false
        if (items) items.forEach(function (c) { c.parent = node })
        node.children = items || []
        node.open = !!items
        if (items) expandedDirs.add(node.path)
        // 拖拽可能把一个已展开目录移进此前收起的父目录。父目录首次展开时，
        // 也要立即恢复其中被记住的子目录展开状态。
        if (items) await restoreExpandedChildren(items)
        setState({ tree: getState().tree })
      } else {
        node.open = !node.open
        if (node.open) expandedDirs.add(node.path)
        else expandedDirs.delete(node.path)
        setState({ tree: getState().tree })
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
      var sel = new Set(getState().selected)
      var lastIndex = getState().lastIndex
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
      var sel = new Set(getState().selected)
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
      var sel = new Set(getState().selected)
      sel.clear()
      sel.add(node.path)
      var rect = e.currentTarget.getBoundingClientRect()
      setState({ selected: sel, lastIndex: null, menu: { x: rect.right - 4, y: rect.bottom + 4, node: node } })
    }

    async function openSelection() {
      var paths = Array.from(getState().selected)
      setState({ menu: null })
      for (var i = 0; i < paths.length; i++) await rpc('open', { path: paths[i] })
    }

    async function trashSelection() {
      var paths = Array.from(getState().selected)
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
      var node = findNode(getState().tree, path)
      var isDir = node && node.type === 'directory'
      var sel = new Set(getState().selected)
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
      if (parent !== getState().cwd) {
        var parentNode = findNode(getState().tree, parent)
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
        if (getState().notice === text) setState({ notice: '' })
      }, 3000)
    }

    function copyPath(target) {
      var p = target && target.path ? target.path : getState().cwd
      setState({ menu: null })
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () { showNotice(T('explorer.renamed')) }).catch(function () {})
        }
      } catch (err) {}
    }

    function onDragStart(e, node) {
      var paths = getState().selected.has(node.path) ? Array.from(getState().selected) : [node.path]
      setState({ dragPaths: paths })
      try { e.dataTransfer.setData('text/plain', paths.join('\n')) } catch (err) {}
      e.dataTransfer.effectAllowed = 'move'
    }

    function doDrop(e, targetDir) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(targetDir, Array.from(e.dataTransfer.files))
        return
      }
      movePaths(getState().dragPaths || [], targetDir)
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
      doDrop(e, getState().cwd)
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
        var node = findNode(getState().tree, p)
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
      var list = (getState().uploads || []).slice()
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
          sessionId: getActiveSessionId(),
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
      var res = await rpc('download', { path: path, sessionId: getActiveSessionId() })
      // 下载同样可能落在会话切换空窗：403 时等待宿主 attach 后重试一次。
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 1000) })
        res = await rpc('download', { path: path, sessionId: getActiveSessionId() })
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

    function onUploadPicker(e, targetDir) {
      var files = Array.from((e.target && e.target.files) || [])
      uploadFiles(targetDir || getState().cwd, files)
      e.target.value = ''
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------

  return {
    pathJoin: pathJoin,
    parentOf: parentOf,
    baseName: baseName,
    defaultCwd: defaultCwd,
    trackSession: trackSession,
    refresh: refresh,
    refreshAll: refreshAll,
    toggleNode: toggleNode,
    formatSize: formatSize,
    onRowClick: onRowClick,
    onRowDoubleClick: onRowDoubleClick,
    onRowContext: onRowContext,
    onBlankContext: onBlankContext,
    onBlankClick: onBlankClick,
    onRowMore: onRowMore,
    openSelection: openSelection,
    trashSelection: trashSelection,
    startRename: startRename,
    commitRename: commitRename,
    startNew: startNew,
    commitNew: commitNew,
    copyPath: copyPath,
    onDragStart: onDragStart,
    onRowDrop: onRowDrop,
    onBodyDrop: onBodyDrop,
    movePaths: movePaths,
    downloadFile: downloadFile,
    onUploadPicker: onUploadPicker,
    autoHeartbeat: autoHeartbeat,
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_EXPLORER_DATA__ = { createExplorerData }
