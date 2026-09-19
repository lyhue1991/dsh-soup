import { ICON_MORE, ICON_NEW_FOLDER, ICON_REFRESH } from './styles.js'
import { iconSvgFor } from './file-icons.js'

/**
 * 资源管理器 UI（区域一 · 🧅 葱）：NameInput / Row / Menu 列表与右键
 * 菜单、Panel 右列面板（宽度合同 300–520px）、HeaderAction / HeroAction
 * 入口按钮。数据层动作与共享状态经 ctx 注入；layout 经 getter 延迟取值
 * （apply 里才赋值）。findFrameEl/setHeroDetailsWidth 亦在此维护。
 */
export function createExplorerView(ctx) {
  var React = ctx.React
  var create = ctx.create
  var T = ctx.T
  var getState = ctx.getState
  var setState = ctx.setState
  var useStore = ctx.useStore
  var getLayout = ctx.getLayout
  var visibleRows = ctx.visibleRows
  var uploadInputEl = null
  var DETAILS_MIN = 300
  var DETAILS_MAX = 520
  var DETAILS_DEFAULT = 360
  function clampW(w) { return Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, w)) }

  // Hook 规则安全兜底：宿主未注入 useSessions 时也必须调用恰好一个 hook，
  // 否则 props.useSessions 在两次渲染间从无到有会触发 React #62（渲染期
  // hook 数量不一致），导致 rightbar 入口崩溃让位、回落到官方面板。
  function noopSubscribe() { return function () {} }
  function undefinedSnapshot() { return undefined }
  var toggleNode = ctx.toggleNode
  var onRowClick = ctx.onRowClick
  var onRowDoubleClick = ctx.onRowDoubleClick
  var onRowContext = ctx.onRowContext
  var onRowMore = ctx.onRowMore
  var onDragStart = ctx.onDragStart
  var onRowDrop = ctx.onRowDrop
  var onBodyDrop = ctx.onBodyDrop
  var onBlankClick = ctx.onBlankClick
  var onBlankContext = ctx.onBlankContext
  var commitRename = ctx.commitRename
  var commitNew = ctx.commitNew
  var formatSize = ctx.formatSize
  var openSelection = ctx.openSelection
  var startRename = ctx.startRename
  var trashSelection = ctx.trashSelection
  var startNew = ctx.startNew
  var copyPath = ctx.copyPath
  var downloadFile = ctx.downloadFile
  var refresh = ctx.refresh
  var refreshAll = ctx.refreshAll
  var trackSession = ctx.trackSession
  var onUploadPicker = ctx.onUploadPicker
  var openFileInTab = ctx.openFileInTab
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
      var isSelected = getState().selected.has(node.path)
      var isRenaming = getState().renaming === node.path
      var isDropTarget = getState().dropTarget === node.path
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
        onDragOver: function (e) { if (isDir) { e.preventDefault(); e.stopPropagation(); if (getState().dropTarget !== node.path) setState({ dropTarget: node.path }) } },
        onDragLeave: function (e) { if (getState().dropTarget === node.path) setState({ dropTarget: null }) },
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
      if (getState().newItem && getState().newItem.parent === node.path && isDir && node.open) {
        children.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 + (depth + 1) * 16 } },
            create('span', { className: 'expl-icon' }, getState().newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(getState().newItem.parent, name, getState().newItem.isDir) },
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
      var multi = getState().selected.size > 1
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
          items.push({ key: 'trash', label: T('menu.trashMulti', { n: getState().selected.size }), danger: true, onClick: trashSelection, separatorAfter: true })
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
        items.push({ key: 'newfile', label: T('menu.newFile'), onClick: function () { startNew(getState().cwd, false) } })
        items.push({ key: 'newfolder', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_NEW_FOLDER } }), T('menu.newFolder')], onClick: function () { startNew(getState().cwd, true) } })
        items.push({ key: 'refresh', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }), T('explorer.refresh')], onClick: refresh, separatorAfter: true })
        if (getState().selected.size > 0) items.push({ key: 'none', label: T('menu.deselect'), onClick: function () { setState({ selected: new Set(), lastIndex: null }) } })
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
      if (getState().newItem && getState().newItem.parent === getState().cwd) {
        bodyChildren.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 } },
            create('span', { className: 'expl-icon' }, getState().newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(getState().newItem.parent, name, getState().newItem.isDir) },
              onCancel: function () { setState({ newItem: null }) },
            }),
          ),
        ))
      }
      if (s.tree.length === 0 && !(getState().newItem && getState().newItem.parent === getState().cwd)) {
        bodyChildren.push(create('div', { key: '__empty__', className: 'expl-muted' },
          s.cwd ? T('explorer.emptyDir') : T('explorer.waitCwd')))
      } else {
        s.tree.forEach(function (node) { bodyChildren.push(create(Row, { key: node.path, node: node, depth: 0 })) })
      }

      var container = create('div', {
        className: 'expl-body' + (getState().dropTarget === getState().cwd ? ' drop-target' : ''),
        onClick: onBlankClick,
        onContextMenu: onBlankContext,
        onDragOver: function (e) { e.preventDefault(); e.stopPropagation(); if (getState().dropTarget !== getState().cwd) setState({ dropTarget: getState().cwd }) },
        onDragLeave: function (e) { if (getState().dropTarget === getState().cwd) setState({ dropTarget: null }) },
        onDrop: onBodyDrop,
      }, bodyChildren)

      return create('div', { ref: panelRef, className: 'expl-panel' },
        create('div', { className: 'expl-resize', onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
        create('div', { className: 'expl-head' },
          create('span', { className: 'expl-title' }, T('explorer.title')),
          create('div', { className: 'expl-head-btns' },
            create('button', {
              className: 'expl-btn',
              onClick: function () { startNew(getState().cwd, true) },
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
                var layout = getLayout()
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
            if (getLayout() && typeof getLayout().closeRightbar === 'function') {
              if (s.open) getLayout().closeRightbar()
              else getLayout().openRightbar(true, false)
            } else if (s.open) getLayout().closeDetails()
            else getLayout().openDetails()
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
                if (getLayout() && typeof getLayout().closeRightbar === 'function') getLayout().closeRightbar()
                else if (getLayout() && typeof getLayout().closeDetails === 'function') getLayout().closeDetails()
              } catch (e) {}
              setHeroDetailsWidth(event.currentTarget, 0)
            } else {
              // 新版宿主在右栏关闭时仍保留三轨网格（末轨 360px），但右栏表面
              // 并未挂载。只拉宽网格列会得到一条空白列；必须先经 getLayout() 打开
              // 右栏让表面挂载，再回到 dsh-soup 的宽度合同。
              try {
                if (getLayout() && typeof getLayout().openRightbar === 'function') getLayout().openRightbar(true, false)
                else if (getLayout() && typeof getLayout().openDetails === 'function') getLayout().openDetails()
              } catch (e) {}
              setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)
            }
          },
          title: T('explorer.label'),
          'aria-label': T('explorer.label'),
        }, '📁'))
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


  return { NameInput: NameInput, Row: Row, Menu: Menu, Panel: Panel, HeaderAction: HeaderAction, HeroAction: HeroAction }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_EXPLORER_VIEW__ = { createExplorerView }
