import { injectPluginStyles, ICON_REFRESH, ICON_NEW_FOLDER, ICON_MORE, EXPAND_SVG, SHRINK_SVG } from './client/styles.js'
import { NS, DICT } from './client/i18n.js'
import { iconSvgFor } from './client/file-icons.js'
import { createRpc, hostBase } from './client/rpc.js'
import { createHtmlPreview } from './client/html-preview.js'
import { parseFileAddress, fileAddressMatches } from './client/file-address.js'
import { createPreviewRenderers, isEditableTextFile } from './client/preview-renderers.js'
import { createSpeedBadge } from './client/speed-badge.js'
import { createGoalBar } from './client/goal-bar.js'
import { createFilesStore } from './client/files-store.js'
import { createFilesView } from './client/files-view.js'
import { createExplorerData } from './client/explorer-data.js'
import { createExplorerView } from './client/explorer-view.js'
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
    var layout = null
    var AUTO_HEARTBEAT_MS = 1000
    var rpc = createRpc({ translate: function (key, params) { return T(key, params) } })
    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（数据 + UI）
    //   数据层实现在 client/explorer-data.js（树加载/自动刷新/选择/拖拽/
    //   上传下载/重命名新建），列表与面板 UI 实现在 client/explorer-view.js
    //   （NameInput/Row/Menu/Panel/HeaderAction/HeroAction）。这里持有共享
    //   store、rpc 与工厂产物；files 相关动作用包装函数延迟解析，保持
    //   apply 生命周期内 locale 重绑定且与初始化顺序无关。
    // ------------------------------------------------------------------
    var explorerData = createExplorerData({
      T: function (key, params) { return T(key, params) },
      rpc: rpc,
      setState: setState,
      getState: function () { return state },
      getActiveSessionId: function () { return activeSessionId },
      setActiveSessionId: function (v) { activeSessionId = v },
      visibleRows: visibleRows,
      pruneFilesToScope: function (files, cwd) { return pruneFilesToScope(files, cwd) },
      scheduleAutoSave: function (path) { return scheduleAutoSave(path) },
      setFiles: function (patch) { return setFiles(patch) },
      findFileEntry: function (path) { return findFileEntry(path) },
      openFileInTab: function (path) { return openFileInTab(path) },
      askOverwrite: function (name) { return askOverwrite(name) },
    })
    var pathJoin = explorerData.pathJoin
    var parentOf = explorerData.parentOf
    var baseName = explorerData.baseName
    var defaultCwd = explorerData.defaultCwd
    var trackSession = explorerData.trackSession
    var refresh = explorerData.refresh
    var refreshAll = explorerData.refreshAll
    var toggleNode = explorerData.toggleNode
    var formatSize = explorerData.formatSize
    var onRowClick = explorerData.onRowClick
    var onRowDoubleClick = explorerData.onRowDoubleClick
    var onRowContext = explorerData.onRowContext
    var onBlankContext = explorerData.onBlankContext
    var onBlankClick = explorerData.onBlankClick
    var onRowMore = explorerData.onRowMore
    var openSelection = explorerData.openSelection
    var trashSelection = explorerData.trashSelection
    var startRename = explorerData.startRename
    var commitRename = explorerData.commitRename
    var startNew = explorerData.startNew
    var commitNew = explorerData.commitNew
    var copyPath = explorerData.copyPath
    var onDragStart = explorerData.onDragStart
    var onRowDrop = explorerData.onRowDrop
    var onBodyDrop = explorerData.onBodyDrop
    var movePaths = explorerData.movePaths
    var downloadFile = explorerData.downloadFile
    var onUploadPicker = explorerData.onUploadPicker
    var autoHeartbeat = explorerData.autoHeartbeat
    var explorerView = createExplorerView({
      React: React,
      create: create,
      T: function (key, params) { return T(key, params) },
      getState: function () { return state },
      setState: setState,
      useStore: useStore,
      getLayout: function () { return layout },
      visibleRows: visibleRows,
      toggleNode: toggleNode,
      onRowClick: onRowClick,
      onRowDoubleClick: onRowDoubleClick,
      onRowContext: onRowContext,
      onRowMore: onRowMore,
      onDragStart: onDragStart,
      onRowDrop: onRowDrop,
      onBodyDrop: onBodyDrop,
      onBlankClick: onBlankClick,
      onBlankContext: onBlankContext,
      commitRename: commitRename,
      commitNew: commitNew,
      formatSize: formatSize,
      openSelection: openSelection,
      startRename: startRename,
      trashSelection: trashSelection,
      startNew: startNew,
      copyPath: copyPath,
      downloadFile: downloadFile,
      refresh: refresh,
      refreshAll: refreshAll,
      trackSession: trackSession,
      onUploadPicker: onUploadPicker,
      openFileInTab: function (path) { return openFileInTab(path) },
    })
    var Panel = explorerView.Panel
    var HeaderAction = explorerView.HeaderAction
    var HeroAction = explorerView.HeroAction
    // ------------------------------------------------------------------
    // ▓▓ 区域二 · 会话内预览 · 🫚 姜（状态 + UI）
    //   状态机实现在 client/files-store.js：打开/重载/关闭、FIFO(≤5)、
    //   编辑草稿与 mtime/size 防冲突保存、按 cwd 裁剪、官方 file 地址桥接。
    //   UI（FilesView 子标签条 + PreviewOverlay 浮层）实现在
    //   client/files-view.js。这里持有工厂产物；T/rpc/state 访问器经包装
    //   函数注入，保持 apply 生命周期内 locale 重绑定行为。
    // ------------------------------------------------------------------
    /** 当前活跃会话：list/read/download 携带给宿主，供围栏直查该会话 cwd。 */
    var activeSessionId = null
    var filesStore = createFilesStore({
      T: function (key, params) { return T(key, params) },
      rpc: rpc,
      setState: setState,
      getState: function () { return state },
      refresh: refresh,
      baseName: baseName,
      defaultCwd: defaultCwd,
      getActiveSessionId: function () { return activeSessionId },
    })
    var pruneFilesToScope = filesStore.pruneFilesToScope
    var setFiles = filesStore.setFiles
    var askOverwrite = filesStore.askOverwrite
    var findFileEntry = filesStore.findFileEntry
    var activateFilesView = filesStore.activateFilesView
    var openFileInTab = filesStore.openFileInTab
    var openFileAddressInSoup = filesStore.openFileAddressInSoup
    var reloadFile = filesStore.reloadFile
    var startEditing = filesStore.startEditing
    var scheduleAutoSave = filesStore.scheduleAutoSave
    var showSavedIndicator = filesStore.showSavedIndicator
    var manuallySaveFile = filesStore.manuallySaveFile
    var stopEditing = filesStore.stopEditing
    var updateDraft = filesStore.updateDraft
    var saveActiveFile = filesStore.saveActiveFile
    var closeFileTab = filesStore.closeFileTab
    var setActiveFile = filesStore.setActiveFile
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

    var viewParts = createFilesView({
      React: React,
      create: create,
      T: function (key, params) { return T(key, params) },
      useStore: useStore,
      setFiles: setFiles,
      findFileEntry: findFileEntry,
      setActiveFile: setActiveFile,
      closeFileTab: closeFileTab,
      FileToolbar: FileToolbar,
      FileContent: FileContent,
    })
    var FilesView = viewParts.FilesView
    var PreviewOverlay = viewParts.PreviewOverlay
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
