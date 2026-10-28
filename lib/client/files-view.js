import { EXPAND_SVG, SHRINK_SVG } from './styles.js'
import { previewKind } from './preview-renderers.js'

/**
 * 会话内预览 UI（区域二 · 🫚 姜）：FilesView 子标签条 + 空会话兜底
 * PreviewOverlay 浮层 + 纯阅读模式标记。渲染器（FileContent/FileToolbar）
 * 与状态机（files-store）经 ctx 注入；T 经包装函数注入保持 apply 生命
 * 周期内 locale 重绑定。
 */
var EMPTY_SEARCH = {
  open: false, query: '', caseSensitive: false, wholeWords: false, regex: false,
  current: 0, total: 0, error: '',
}
var SEARCH_DEBOUNCE_MS = 200
var SEARCH_MAX_MATCHES = 5000

function searchOf(files) {
  return Object.assign({}, EMPTY_SEARCH, files && files.search ? files.search : {})
}

function selectedSearchText(root) {
  try {
    var selection = window.getSelection ? window.getSelection() : null
    if (root && selection && selection.anchorNode && !root.contains(selection.anchorNode)) return ''
    var value = String(selection ? selection.toString() : '').split(/\r?\n/)[0].trim()
    return value && value.length <= 200 ? value : ''
  } catch (err) { return '' }
}

function escapeRegExp(value) {
  return String(value).replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')
}

function buildSearchRegExp(search) {
  if (!search.query) return null
  var source = search.regex ? search.query : escapeRegExp(search.query)
  if (search.wholeWords) source = '\\b(?:' + source + ')\\b'
  return new RegExp(source, search.caseSensitive ? 'g' : 'gi')
}

function setSearchHighlight(ranges, currentIndex) {
  try {
    if (typeof window === 'undefined' || !window.CSS || !window.CSS.highlights || typeof window.Highlight !== 'function') return
    if (!ranges.length) {
      window.CSS.highlights.delete('dsh-soup-search')
      window.CSS.highlights.delete('dsh-soup-search-current')
      return
    }
    var highlight = new window.Highlight()
    for (var i = 0; i < ranges.length; i++) highlight.add(ranges[i])
    window.CSS.highlights.set('dsh-soup-search', highlight)
    var current = new window.Highlight()
    current.add(ranges[Math.max(0, Math.min(currentIndex || 0, ranges.length - 1))])
    window.CSS.highlights.set('dsh-soup-search-current', current)
  } catch (err) {}
}

function clearSearchHighlight() {
  setSearchHighlight([])
}

function findTextRanges(root, re) {
  var matches = []
  if (!root || !document.createTreeWalker) return matches
  var rejectedTags = new Set(['script', 'style', 'iframe', 'object', 'img', 'svg'])
  var walker = document.createTreeWalker(root, 4, {
    acceptNode: function (node) {
      var parent = node.parentElement
      if (!parent) return 2
      if (rejectedTags.has(parent.tagName.toLowerCase())) return 2
      if (parent.closest && parent.closest('.dfv-searchbar')) return 2
      return 1
    },
  })
  var node
  while ((node = walker.nextNode()) && matches.length < SEARCH_MAX_MATCHES) {
    var text = node.nodeValue || ''
    re.lastIndex = 0
    var match
    while ((match = re.exec(text)) !== null) {
      if (!match[0]) { re.lastIndex++; continue }
      var range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      matches.push(range)
      if (matches.length >= SEARCH_MAX_MATCHES) break
    }
  }
  return matches
}

function focusRange(range) {
  try {
    // Keep the search input focused and scroll only the preview's own scroller.
    // A bare scrollIntoView() may also move the DSH view container, which would
    // hide this overlay while a match is being refreshed.
    var el = range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentElement
    function isScrollable(node) {
      if (!node || node.nodeType !== 1) return false
      var style = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(node) : null
      var overflowY = style ? style.overflowY : ''
      var overflowX = style ? style.overflowX : ''
      var allowsY = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
      var allowsX = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay'
      return (allowsY && node.scrollHeight > node.clientHeight)
        || (allowsX && node.scrollWidth > node.clientWidth)
    }
    var scrollers = []
    var scroller = el
    while (scroller && scroller !== document.body) {
      if (isScrollable(scroller)) scrollers.push(scroller)
      scroller = scroller.parentElement
    }
    if (!scrollers.length || !range.getBoundingClientRect) return
    // Adjust each scroll owner from the innermost preview wrapper outward.
    // This covers code cells, notebook outputs, and a host view that owns the
    // scrollbar, while the fixed search overlay follows the host scroll.
    for (var i = 0; i < scrollers.length; i++) {
      var owner = scrollers[i]
      if (!owner.getBoundingClientRect) continue
      var hit = range.getBoundingClientRect()
      var box = owner.getBoundingClientRect()
      if (hit.top < box.top) owner.scrollTop -= box.top - hit.top
      else if (hit.bottom > box.bottom) owner.scrollTop += hit.bottom - box.bottom
      if (hit.left < box.left) owner.scrollLeft -= box.left - hit.left
      else if (hit.right > box.right) owner.scrollLeft += hit.right - box.right
    }
  } catch (err) {}
}

export function createFilesView(ctx) {
  var React = ctx.React
  var create = ctx.create
  var T = ctx.T
  var useStore = ctx.useStore
  var setFiles = ctx.setFiles
  var findFileEntry = ctx.findFileEntry
  var setActiveFile = ctx.setActiveFile
  var closeFileTab = ctx.closeFileTab
  var openEditorSearch = ctx.openEditorSearch
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

  function SearchBar(props) {
    var search = props.search
    var status = search.query ? (search.current + 1) + '/' + search.total : '0/0'
    var toggles = [
      { key: 'caseSensitive', label: 'Aa', title: T('files.searchCaseTitle') },
      { key: 'wholeWords', label: '\\b', title: T('files.searchWholeWordTitle') },
      { key: 'regex', label: '.*', title: T('files.searchRegexTitle') },
    ].map(function (item) {
      return create('button', {
        key: item.key,
        type: 'button',
        className: 'dfv-search-toggle' + (search[item.key] ? ' active' : ''),
        title: item.title,
        'aria-pressed': !!search[item.key],
        onClick: function () { props.onToggle(item.key) },
      }, item.label)
    })
    return create('div', {
      className: 'dfv-searchbar', role: 'search', style: props.position || { visibility: 'hidden' },
    },
      create('input', {
        ref: props.inputRef,
        className: 'dfv-search-input',
        type: 'text',
        value: search.query,
        placeholder: T('files.searchPlaceholder'),
        'aria-label': T('files.searchTitle'),
        spellCheck: false,
        autoComplete: 'off',
        onChange: function (e) { props.onQuery(e.target.value) },
        onKeyDown: function (e) {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            props.onMove(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            props.onClose()
          }
        },
      }),
      toggles,
      create('span', { className: 'dfv-search-status', 'aria-live': 'polite' }, status),
      create('button', {
        type: 'button', className: 'dfv-search-toggle', title: T('files.searchPreviousTitle'),
        onClick: function () { props.onMove(-1) },
      }, '↑'),
      create('button', {
        type: 'button', className: 'dfv-search-toggle', title: T('files.searchNextTitle'),
        onClick: function () { props.onMove(1) },
      }, '↓'),
      create('button', {
        type: 'button', className: 'dfv-search-toggle', title: T('files.searchCloseTitle'),
        onClick: props.onClose,
      }, '✕'),
      search.error ? create('span', { className: 'dfv-search-error', title: search.error }, '!') : null,
    )
  }

  function FileSurface(props) {
    var entry = props.entry
    var isOverlay = !!props.isOverlay
    var s = useStore()
    var files = s.files
    var search = searchOf(files)
    var surfaceRef = React.useRef(null)
    var bodyRef = React.useRef(null)
    var inputRef = React.useRef(null)
    var matchesRef = React.useRef([])
    var positionState = React.useState(null)
    var searchPosition = positionState[0]
    var setSearchPosition = positionState[1]

    function updateSearchPosition() {
      if (!surfaceRef.current || typeof window === 'undefined') return
      var rect = surfaceRef.current.getBoundingClientRect()
      setSearchPosition({
        top: Math.max(8, Math.round(rect.top + 8)),
        right: Math.max(8, Math.round(window.innerWidth - rect.right + 18)),
      })
    }

    function updateSearch(patch) {
      setFiles({ search: Object.assign({}, search, patch) })
    }

    function closeSearch() {
      matchesRef.current = []
      clearSearchHighlight()
      updateSearch({ open: false, current: 0, total: 0, error: '' })
    }

    function focusMatch(index) {
      var ranges = matchesRef.current
      if (!ranges.length) return
      var current = ((index % ranges.length) + ranges.length) % ranges.length
      focusRange(ranges[current])
    }

    function moveSearch(delta) {
      var total = matchesRef.current.length
      if (!total) return
      var current = ((search.current + delta) + total) % total
      setSearchHighlight(matchesRef.current, current)
      updateSearch({ current: current })
      focusMatch(current)
    }

    function runSearch() {
      var root = bodyRef.current
      var searchInputHadFocus = typeof document !== 'undefined'
        && document.activeElement === inputRef.current
      matchesRef.current = []
      clearSearchHighlight()
      if (!search.open || entry.editing || !search.query) {
        updateSearch({ current: 0, total: 0, error: '' })
        return
      }
      var re
      try { re = buildSearchRegExp(search) }
      catch (err) {
        updateSearch({ current: 0, total: 0, error: err.message })
        return
      }
      var ranges = findTextRanges(root, re)
      matchesRef.current = ranges
      setSearchHighlight(ranges, 0)
      updateSearch({ current: 0, total: ranges.length, error: '' })
      if (ranges.length) focusMatch(0)
      if (searchInputHadFocus && inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus({ preventScroll: true })
      }
    }

    React.useEffect(function () {
      if (!search.open) return
      var timer = setTimeout(function () {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
      return function () { clearTimeout(timer) }
    }, [search.open, entry.path])

    React.useEffect(function () {
      if (!search.open || entry.editing || (!isOverlay && files.overlay)) {
        setSearchPosition(null)
        return
      }
      updateSearchPosition()
      var onScroll = function () { updateSearchPosition() }
      var onResize = function () { updateSearchPosition() }
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', onResize)
      var observer = null
      if (typeof ResizeObserver === 'function' && surfaceRef.current) {
        observer = new ResizeObserver(updateSearchPosition)
        observer.observe(surfaceRef.current)
      }
      return function () {
        window.removeEventListener('scroll', onScroll, true)
        window.removeEventListener('resize', onResize)
        if (observer) observer.disconnect()
      }
    }, [search.open, entry.editing, entry.path, files.overlay, isOverlay])

    React.useEffect(function () {
      if (!search.open || entry.editing || (!isOverlay && files.overlay)) return
      var timer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS)
      return function () { clearTimeout(timer) }
    }, [
      search.open, search.query, search.caseSensitive, search.wholeWords, search.regex,
      entry.path, entry.content, entry.draft, entry.editing, files.overlay, isOverlay,
    ])

    React.useEffect(function () {
      return function () {
        matchesRef.current = []
        clearSearchHighlight()
      }
    }, [entry.path])

    React.useEffect(function () {
      if (search.open) updateSearch({ open: false, current: 0, total: 0, error: '' })
    }, [entry.path])

    React.useEffect(function () {
      if (entry.editing && search.open) {
        matchesRef.current = []
        clearSearchHighlight()
        updateSearch({ open: false, current: 0, total: 0, error: '' })
      }
    }, [entry.editing])

    function openPreviewSearch() {
      var query = selectedSearchText(bodyRef.current) || search.query
      setFiles({
        search: Object.assign({}, EMPTY_SEARCH, {
          open: true, query: query,
          caseSensitive: search.caseSensitive, wholeWords: search.wholeWords, regex: search.regex,
        }),
      })
    }

    function onKeyDown(e) {
      var isFind = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
        && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF')
      var isFindNavigation = search.open && (
        e.key === 'F3' || ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G' || e.code === 'KeyG'))
      )
      if (!isFind && !isFindNavigation) return
      if (entry.editing) {
        if (openEditorSearch && openEditorSearch(entry.path)) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (isFindNavigation) {
        e.preventDefault()
        e.stopPropagation()
        moveSearch(e.shiftKey ? -1 : 1)
        return
      }
      if (entry.kind === 'text' && previewKind(entry.path) !== 'html') {
        e.preventDefault()
        e.stopPropagation()
        openPreviewSearch()
      }
    }

    var showSearch = search.open && !entry.editing && entry.kind === 'text'
      && previewKind(entry.path) !== 'html' && (isOverlay || !files.overlay)
    return create('div', { className: 'dfv-file-surface', ref: surfaceRef, onKeyDown: onKeyDown },
      showSearch ? create(SearchBar, {
        search: search,
        position: searchPosition || { visibility: 'hidden' },
        inputRef: inputRef,
        onQuery: function (value) { updateSearch({ query: value, current: 0, error: '' }) },
        onToggle: function (key) {
          var patch = {}
          patch[key] = !search[key]
          updateSearch(patch)
        },
        onMove: function (delta) { moveSearch(delta) },
        onClose: closeSearch,
      }) : null,
      create('div', { className: 'dfv-body', ref: bodyRef },
        create(FileContent, { key: entry.path, entry: entry }),
      ),
    )
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
      body = create(FileSurface, { entry: active, isOverlay: false })
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
        create(FileSurface, { entry: active, isOverlay: true }),
      ),
    )
  }

  return { FilesView: FilesView, PreviewOverlay: PreviewOverlay }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_FILES_VIEW__ = { createFilesView }
