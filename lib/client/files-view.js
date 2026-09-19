import { EXPAND_SVG, SHRINK_SVG } from './styles.js'

/**
 * 会话内预览 UI（区域二 · 🫚 姜）：FilesView 子标签条 + 空会话兜底
 * PreviewOverlay 浮层 + 纯阅读模式标记。渲染器（FileContent/FileToolbar）
 * 与状态机（files-store）经 ctx 注入；T 经包装函数注入保持 apply 生命
 * 周期内 locale 重绑定。
 */
export function createFilesView(ctx) {
  var React = ctx.React
  var create = ctx.create
  var T = ctx.T
  var useStore = ctx.useStore
  var setFiles = ctx.setFiles
  var findFileEntry = ctx.findFileEntry
  var setActiveFile = ctx.setActiveFile
  var closeFileTab = ctx.closeFileTab
  var FileToolbar = ctx.FileToolbar
  var FileContent = ctx.FileContent

  /**
   * 纯阅读模式标记：在会话根（含 composerSeat 的最近祖先，即 DSH
   * ConversationRoot 的 root 节点）上打 data-dsh-soup-preview，由注入的
   * CSS 隐藏输入区与轮次统计行。DSH 重渲染可能重建该节点——
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

  return { FilesView: FilesView, PreviewOverlay: PreviewOverlay }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_FILES_VIEW__ = { createFilesView }
