/**
 * dsh-tree — 浏览器半区：项目资源管理器。
 *
 * 布局：注册进 shell 原生的 `details` 右列（并列网格，非悬浮），
 * 头部右侧工具区（Session log 右侧）放一个 📁 切换按钮。
 * 宽度与左侧工作区一致：默认 280px、可拖 264–420px（直接改写 shell 网格
 * 的 details 轨，并用 MutationObserver 在 shell 重渲染后维持宽度）。
 *
 * 与宿主通信：走同源 HTTP 路由 `/api/dsh-tree`（POST JSON），
 * 即永久插件（profile bundle）规范桥梁，而非 dynamic 半区的 host.call。
 */
window.__ModuleLoader__.load({
  id: '@lyhue1991/dsh-tree',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var create = React.createElement

    // ------------------------------------------------------------------
    // 样式：一次性注入 <style data-plugin>（与官方插件 css 内联约定一致）
    // ------------------------------------------------------------------
    var EXPL_CSS = '.expl-panel{position:relative;height:100%;min-width:0;width:100%;display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family);overflow:hidden;box-sizing:border-box;}' +
      '.expl-resize{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:col-resize;z-index:6;touch-action:none;}' +
      '.expl-resize::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:3px;height:40px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover);opacity:0;transition:opacity .15s;}' +
      '.expl-resize:hover::after{opacity:1;}' +
      '[data-side="details"]{display:none!important;}' +
      '.expl-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-title{font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;font-size:14px;}' +
      '.expl-head-btns{display:flex;gap:2px;flex-wrap:nowrap;}' +
      '.expl-btn{background:transparent;border:none;color:var(--dsw-alias-label-secondary);font-size:15px;cursor:pointer;padding:3px 7px;border-radius:8px;}' +
      '.expl-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.expl-path{font-size:11px;color:var(--dsw-alias-label-secondary);padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;flex:none;cursor:default;}' +
      '.expl-error{color:var(--dsw-alias-state-error-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-notice{color:var(--dsw-alias-state-success-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-bulk{color:var(--dsw-alias-state-business-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-body{overflow:auto;flex:1;padding:6px 0 12px;}' +
      '.expl-row-main{display:flex;align-items:center;gap:6px;padding-top:2px;padding-bottom:2px;padding-right:10px;cursor:pointer;border-radius:8px;margin:0 4px;height:40px;box-sizing:border-box;user-select:none;}' +
      '.expl-row-main:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-row-main.selected{background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-row-main.drop-target,.expl-body.drop-target{outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:-2px;background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-caret{flex:none;cursor:pointer;line-height:1;}' +
      '.expl-caret-big{width:24px;font-size:33px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:flex-start;}' +
      '.expl-caret-sm{width:24px;font-size:33px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:flex-start;}' +
      '.expl-icon{flex:none;}' +
      '.expl-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}' +
      '.expl-size{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;margin-left:8px;}' +
      '.expl-muted{color:var(--dsw-alias-label-tertiary);padding:4px 14px;font-size:12px;}' +
      '.expl-menu-mask{position:fixed;inset:0;z-index:1980;}' +
      '.expl-menu{position:fixed;z-index:1990;min-width:172px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;padding:4px;box-shadow:var(--dsw-shadow-lv3);pointer-events:auto;}' +
      '.expl-menu-item{display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 10px;border-radius:8px;cursor:pointer;line-height:1.4;}' +
      '.expl-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-danger{color:var(--dsw-alias-state-error-primary);} .expl-menu-item.expl-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);}' +
      '.expl-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1);}' +
      '.expl-inline-input{flex:1;min-width:0;height:30px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-state-business-primary);border-radius:6px;padding:0 5px;outline:none;font-family:var(--ds-font-family-code);}' +
      '.expl-toggle{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;} ' +
      '.expl-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-tool{width:34px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent;border-radius:18px;font-size:15px;line-height:1;}' +
      '.expl-active{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-tree/explorer.css"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = '@lyhue1991/dsh-tree'
      tag.dataset.pluginCss = '@lyhue1991/dsh-tree/explorer.css'
      tag.textContent = EXPL_CSS
      document.head.appendChild(tag)
    }

    /** 需要的客户端服务：slots（注册座位）、layout（右列开合）、timer（轮询）。 */
    var inject = ['slots', 'layout', 'timer']

    // ------------------------------------------------------------------
    // 状态存储（模块级，供 Panel 与 HeaderAction 共享）
    // ------------------------------------------------------------------
    var state = {
      open: false, cwd: '', tree: [], menu: null, error: '', notice: '',
      selected: new Set(), lastIndex: null,
      renaming: null, newItem: null,
      dropTarget: null, dragPaths: null,
    }
    var listeners = new Set()
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

    var visibleRows = []
    var uploadInputEl = null
    var layout = null

    var DETAILS_MIN = 264
    var DETAILS_MAX = 420
    var DETAILS_DEFAULT = 280
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
    // 与宿主通信：POST /api/dsh-tree
    // ------------------------------------------------------------------
    function hostBase() {
      var origin = globalThis.location && globalThis.location.origin
      return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
    }
    function rpc(action, args) {
      return fetch(new URL('/api/dsh-tree', hostBase()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action, args: args || {} }),
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: '宿主响应解析失败' } })
      }).catch(function (err) {
        return { ok: false, error: '宿主不可达: ' + String((err && err.message) || err) }
      })
    }

    async function loadDir(path) {
      var res = await rpc('list', { path: path })
      if (!res || !res.ok) {
        setState({ error: (res && res.error) || '读取失败' })
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
      // 已知会话但不能确定其工作目录时，回退到文件系统根，而不是"宿主启动目录"——
      // 后者（root）会让资源管理器误显示与当前会话无关的启动路径。
      return '/'
    }

    async function trackSession(sessionId, cwdHint) {
      var cwd = await defaultCwd(sessionId, cwdHint)
      setState({ cwd: cwd, selected: new Set(), renaming: null, newItem: null, menu: null })
      var items = await loadDir(cwd)
      if (items) setState({ error: '', tree: items })
    }

    async function refresh() {
      if (!state.cwd) return
      var items = await loadDir(state.cwd)
      if (items) setState({ error: '', tree: items })
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
        node.open = true
        setState({ tree: state.tree })
      } else {
        node.open = !node.open
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

    function iconFor(node) {
      if (node.type === 'directory') return '📁'
      var name = String(node.name || '')
      var ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
      if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return '🟨'
      if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return '🟫'
      if (['md', 'txt', 'markdown'].includes(ext)) return '📄'
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return '🖼'
      if (['py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs'].includes(ext)) return '🐍'
      if (['html', 'htm', 'css', 'scss'].includes(ext)) return '🌐'
      if (['sh', 'bash', 'zsh'].includes(ext)) return '⚙'
      return '📄'
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
        rpc('open', { path: node.path })
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

    async function openSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      for (var i = 0; i < paths.length; i++) await rpc('open', { path: paths[i] })
    }

    async function trashSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      var errors = []
      for (var i = 0; i < paths.length; i++) {
        var res = await rpc('trash', { path: paths[i] })
        if (!res || !res.ok) errors.push(baseName(paths[i]) + ': ' + ((res && res.error) || '失败') + ((res && res.hint) ? '（' + res.hint + '）' : ''))
      }
      if (errors.length) setState({ error: errors.join('；') })
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
      var sel = new Set(state.selected)
      if (sel.has(path)) { sel.delete(path); sel.add(dest) }
      setState({ renaming: null, selected: sel })
      ;(async function () {
        var res = await rpc('move', { from: path, to: dest })
        if (!res || !res.ok) setState({ error: (res && res.error) || '重命名失败' })
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
        if (!res || !res.ok) setState({ error: (res && res.error) || '创建失败' })
        await refresh()
      })()
    }

    function copyPath() {
      var target = state.menu && state.menu.node
      var p = target ? target.path : state.cwd
      setState({ menu: null })
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () { setState({ notice: '已复制路径' }) }).catch(function () {})
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
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i]
        if (p === '/' || !p) continue
        var name = baseName(p)
        var dest = pathJoin(targetDir, name)
        if (dest === p) continue
        if (targetDir === p || targetDir.startsWith(p + '/')) { errors.push('不能把文件夹移入自身: ' + name); continue }
        var res = await rpc('move', { from: p, to: dest })
        if (!res || !res.ok) errors.push(name + ': ' + ((res && res.error) || '失败'))
      }
      setState({ dragPaths: null })
      if (errors.length) setState({ error: errors.join('；') })
      await refresh()
    }

    function fileToBase64(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader()
        r.onload = function () { var s = String(r.result || ''); var i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s) }
        r.onerror = function () { reject(new Error('读取文件失败')) }
        r.readAsDataURL(file)
      })
    }

    async function uploadFiles(dir, files) {
      if (!files || !files.length) return
      var errors = []
      for (var i = 0; i < files.length; i++) {
        var f = files[i]
        var b64 = ''
        try { b64 = await fileToBase64(f) } catch (err) { errors.push(f.name + ': ' + String((err && err.message) || err)); continue }
        var res = await rpc('upload', { dir: dir, name: f.name, data: b64 })
        if (!res || !res.ok) errors.push(f.name + ': ' + ((res && res.error) || '失败'))
      }
      if (errors.length) setState({ error: errors.join('；') })
      await refresh()
    }

    function onUploadPicker(e) {
      var files = Array.from((e.target && e.target.files) || [])
      uploadFiles(state.cwd, files)
      e.target.value = ''
    }

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
        create('span', {
          className: 'expl-caret' + (isDir ? ' expl-caret-big' : ' expl-caret-sm'),
          onClick: function (e) { if (isDir) { e.stopPropagation(); toggleNode(node) } },
        }, isDir ? (node.open ? '▾' : '▸') : '·'),
        create('span', { className: 'expl-icon' }, iconFor(node)),
        isRenaming
          ? create(NameInput, {
              initial: node.name,
              selectBase: true,
              onCommit: function (name) { commitRename(node.path, name) },
              onCancel: function () { setState({ renaming: null }) },
            })
          : create('span', { className: 'expl-name' }, node.name),
        !isDir ? create('span', { className: 'expl-size' }, formatSize(node.size)) : null,
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
          children.push(create('div', { key: '__loading__', className: 'expl-muted', style: { paddingLeft: 8 + (depth + 1) * 16 } }, '加载中…'))
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
          items.push({ key: 'open', label: '⌘ 用系统打开', onClick: openSelection, separatorAfter: true })
          items.push({ key: 'rename', label: '✎ 重命名', onClick: function () { startRename(node) } })
          items.push({ key: 'trash', label: '🗑 移到废纸篓', danger: true, onClick: trashSelection, separatorAfter: true })
        } else {
          items.push({ key: 'trash', label: '🗑 移到废纸篓 (' + state.selected.size + ' 项)', danger: true, onClick: trashSelection, separatorAfter: true })
        }
        if (node.type === 'directory') {
          items.push({ key: 'newfile', label: '📄 新建文件', onClick: function () { startNew(node.path, false) } })
          items.push({ key: 'newfolder', label: '📁 新建文件夹', onClick: function () { startNew(node.path, true) }, separatorAfter: true })
        }
        items.push({ key: 'copy', label: '⧉ 复制路径', onClick: copyPath })
      } else {
        items.push({ key: 'newfile', label: '📄 新建文件', onClick: function () { startNew(state.cwd, false) } })
        items.push({ key: 'newfolder', label: '📁 新建文件夹', onClick: function () { startNew(state.cwd, true) } })
        items.push({ key: 'refresh', label: '⟳ 刷新', onClick: refresh, separatorAfter: true })
        if (state.selected.size > 0) items.push({ key: 'none', label: '取消选择', onClick: function () { setState({ selected: new Set(), lastIndex: null }) } })
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
        menuChildren.push(create('button', {
          key: it.key,
          className: 'expl-menu-item' + (it.danger ? ' expl-danger' : ''),
          onClick: function () { setState({ menu: null }); it.onClick() },
        }, it.label))
        if (it.separatorAfter) menuChildren.push(create('div', { key: it.key + '-sep', className: 'expl-menu-sep' }))
      })
      return create('div', { ref: menuRef, className: 'expl-menu', style: { left: pos.x, top: pos.y } }, menuChildren)
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

      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId])

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
              if (Math.round(last) !== Math.round(widthRef.current)) {
                parts[parts.length - 1] = Math.round(widthRef.current) + 'px'
                frame.style.gridTemplateColumns = parts.join(' ')
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
        bodyChildren.push(create('div', { key: '__empty__', className: 'expl-muted' }, '（空目录）'))
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
          create('span', { className: 'expl-title' }, '📁 资源管理器'),
          create('div', { className: 'expl-head-btns' },
            create('button', { className: 'expl-btn', onClick: function () { if (uploadInputEl) uploadInputEl.click() }, title: '上传文件' }, '⬆'),
            create('button', { className: 'expl-btn', onClick: function () { try { layout.closeDetails() } catch (e) {} }, title: '关闭' }, '✕'),
          ),
        ),
        create('div', { className: 'expl-path', title: s.cwd || '' }, s.cwd || '…'),
        create('input', { type: 'file', multiple: true, style: { display: 'none' }, ref: function (el) { uploadInputEl = el }, onChange: onUploadPicker }),
        s.error ? create('div', { className: 'expl-error' }, s.error) : null,
        s.notice ? create('div', { className: 'expl-notice' }, s.notice) : null,
        s.selected.size > 1
          ? create('div', { className: 'expl-bulk' }, '已选 ' + s.selected.size + ' 项 · 拖到文件夹可移动')
          : null,
        container,
        s.menu ? create('div', { className: 'expl-menu-mask', onMouseDown: function () { setState({ menu: null }) }, onContextMenu: function (e) { e.preventDefault(); setState({ menu: null }) } }) : null,
        s.menu ? create(Menu, { menu: s.menu }) : null,
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
      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId])
      return create('button', {
        type: 'button',
        className: 'expl-toggle expl-tool' + (s.open ? ' expl-active' : ''),
        onClick: function () { try { if (s.open) layout.closeDetails(); else layout.openDetails() } catch (e) {} },
        title: '项目资源管理器',
        'aria-label': '项目资源管理器',
      }, '📁')
    }

    // ------------------------------------------------------------------
    // 速度徽标：DOM 注入到 Deep diving（role=status）旁。
    // 不改 DSH 源码。用 MutationObserver 定位消息流里的 Deep diving，
    // 把徽标节点 append 进其行内（inline-flex 同行），实现永远紧贴。
    // ------------------------------------------------------------------
    // 模块级 timer 引用：apply(ctx) 里赋值（与 dsh-tree 现有 layout 同款模式）
    var timerRef = null

    function SpeedBadge(props) {
      var sessionId = props && (props.sessionId || (props.session && props.session.id))

      // 持有最新状态的最新值的 ref（供 MutationObserver 回调读取）
      var statusRef = React.useRef(null)
      var dotsRef = React.useRef(1)
      var badgeElRef = React.useRef(null)

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

      // hostRef：Deep diving 宿主元素（当前挂载点）
      var hostRef = React.useRef(null)

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
        if (st.phase === 'waiting' || !st.tps) {
          el.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;font-weight:400;font-size:13px;color:var(--dsw-alias-label-caption);'
          el.style.setProperty('color', 'var(--dsw-alias-label-caption)', 'important')
          el.style.setProperty('-webkit-text-fill-color', 'var(--dsw-alias-label-caption)', 'important')
          el.textContent = '正在等待模型' + new Array(dotsRef.current + 1).join('.')
          return
        }
        var tps = st.tps
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
        var pill = document.createElement('span')
        pill.style.cssText = 'margin-left:6px;padding:1px 6px;border-radius:4px;background:' + bg + ';color:#fff;-webkit-text-fill-color:#fff;font-size:11px;font-weight:500;'
        pill.textContent = tps.toFixed(1) + ' t/s'
        el.appendChild(pill)
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
            if (candidates[i].textContent && candidates[i].textContent.indexOf('Deep diving') !== -1) return candidates[i]
          }
          return null
        }

        function attach() {
          // 已挂载且宿主仍在 DOM 中时无需重复查找：徽标内容由 timer/poll 驱动
          // renderBadge 更新，observer 只负责把徽标挂进/移出宿主元素。
          if (hostRef.current && hostRef.current.isConnected) {
            if (badge.parentNode !== hostRef.current) {
              try { hostRef.current.appendChild(badge) } catch (e) {}
            } else if (hostRef.current.lastElementChild !== badge) {
              // DSH may append the elapsed-time span after the badge is mounted.
              // Keep the badge as the final child so it always follows the clock.
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

    /** 应用浏览器半区：注册头部切换按钮与 details 右列面板。 */
    function apply(ctx) {
      var slots = ctx.slots
      layout = ctx.layout
      timerRef = ctx.timer
      var disposers = []
      slots.inject('conversation.session.header.utilities', function () {
        disposers.push(slots.register(
          { name: 'conversation.session.header.utilities', id: 'dsh-tree-toggle', order: 10, label: '资源管理器' },
          function (props) { return create(HeaderAction, props) },
        ))
      })
      slots.inject('details', function () {
        disposers.push(slots.register(
          // `details` is a single slot occupied by the shell at priority 0.
          // Lower priorities render first, so this intentionally shadows it.
          { name: 'details', priority: -1 },
          function (props) { return create(Panel, props) },
        ))
      })
      slots.inject('conversation.input.dock', function () {
        disposers.push(slots.register(
          { name: 'conversation.input.dock', id: 'dsh-speed-badge', order: 30, label: '速度徽标' },
          function (props) { return create(SpeedBadge, props) },
        ))
      })
      ctx.effect(
        function () { return function () { disposers.forEach(function (d) { try { d() } catch (e) {} }) } },
        'dsh-tree: header toggle + details panel + speed badge',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
