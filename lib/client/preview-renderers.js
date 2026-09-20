/**
 * 会话内预览渲染器（区域二 · 🫚 姜）：按扩展名分派 md/html/pdf/notebook/
 * json/csv + 图片/纯文本兜底 + CodeMirror 文本编辑器 + FileContent 分派 +
 * FileToolbar。信任模型参考 JupyterLab viewer——markdown 走不可信安全渲染
 * 管线，html 进沙箱 iframe（实现在 html-preview.js）。
 *
 * 依赖宿主运行时对象（React、CodeMirror 模块、MarkdownText/CodeBlock、
 * 编辑动作）由 main 经工厂参数注入；纯辅助函数同时导出供 main 复用。
 */

import { hostBase } from './rpc.js'
import { CODE_LANG_BY_EXT } from './file-icons.js'
import { ICON_REFRESH, FILE_ICON_EDIT, FILE_ICON_PREVIEW } from './styles.js'

/** 取路径小写扩展名。 */
export function extOfName(p) {
  var m = /\.([A-Za-z0-9]+)$/.exec(String(p || ''))
  return m ? m[1].toLowerCase() : ''
}

/** 预览渲染器类型：markdown | html | json | csv | tsv | notebook | code | text。 */
export function previewKind(path) {
  var ext = extOfName(path)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'json') return 'json'
  if (ext === 'ipynb') return 'notebook'
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  return 'text'
}

/** RFC 4180 风格的分隔符解析（引号感知，"" 转义），返回行数组。 */
export function parseDelimited(text, delim) {
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

/** 人类可读的字节数。 */
export function formatBytes(n) {
  if (typeof n !== 'number' || n < 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
  return (n / 1073741824).toFixed(1) + ' GB'
}

/** 可编辑文本：markdown/html/json 或语言表覆盖的代码扩展名。 */
export function isEditableTextFile(path) {
  var kind = previewKind(path)
  var ext = extOfName(path)
  return kind === 'markdown' || kind === 'html' || kind === 'json'
    || Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, ext)
}

/**
 * 创建预览渲染器组件集。
 * @param {object} ctx
 * - React/create：React 与 createElement。
 * - T：翻译函数（main 侧 apply 内 locale 重绑定，经包装函数取当前值）。
 * - cm：CodeMirror 模块集 { EditorView, EditorState, Keymap, Commands, Language, HighlightTags, Langs }。
 * - MarkdownText/CodeBlock：DSH ui-primitives 的可选渲染器（缺省回退纯文本）。
 * - HtmlPreview：html-preview.js 工厂产物。
 * - parentOf：父目录工具函数（explorer 侧同款）。
 * - getActiveSessionId：当前会话 id 的 getter。
 * - updateDraft/manuallySaveFile/startEditing/stopEditing/reloadFile：files tab 动作。
 */
export function createPreviewRenderers(ctx) {
  var React = ctx.React
  var create = ctx.create
  var T = ctx.T
  var CMEditorView = ctx.cm.EditorView
  var CMEditorState = ctx.cm.EditorState
  var CMKeymap = ctx.cm.Keymap
  var CMCommands = ctx.cm.Commands
  var CMLanguage = ctx.cm.Language
  var CMHighlightTags = ctx.cm.HighlightTags
  var CMLangs = ctx.cm.Langs
  var MarkdownText = ctx.MarkdownText
  var CodeBlock = ctx.CodeBlock
  var HtmlPreview = ctx.HtmlPreview
  var parentOf = ctx.parentOf
  var getActiveSessionId = ctx.getActiveSessionId
  var updateDraft = ctx.updateDraft
  var manuallySaveFile = ctx.manuallySaveFile
  var startEditing = ctx.startEditing
  var stopEditing = ctx.stopEditing
  var reloadFile = ctx.reloadFile
  var downloadFile = ctx.downloadFile

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
        { tag: CMHighlightTags.operator, color: 'var(--dsh-soup-code-operator)' },
        { tag: CMHighlightTags.operatorKeyword, color: 'var(--dsh-soup-code-operator)' },
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

  /** 超过该字符数的代码文件不做高亮（Shiki 首次高亮的耗时保护）。 */
  var CODE_HIGHLIGHT_MAX_CHARS = 400000
  /** 超过该字符数的 JSON 直接按纯文本预览，避免解析和行号 DOM 开销。 */
  var JSON_PREVIEW_MAX_CHARS = 300000

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
    var jsonPreviewTruncated = false
    if (pk === 'markdown') view = create(MarkdownPreview, { text: text, baseDir: parentOf(entry.path) })
    else if (pk === 'html') view = create(HtmlPreview, {
      text: text, path: entry.path, sessionId: getActiveSessionId(), title: entry.name,
    })
    else if (pk === 'json') {
      if (text.length > JSON_PREVIEW_MAX_CHARS) {
        jsonPreviewTruncated = true
        view = create('pre', { className: 'dfv-json dfv-code' }, text.slice(0, JSON_PREVIEW_MAX_CHARS))
      } else {
        view = create(CodeWithLines, { text: text }, create(JsonPreview, { text: text }))
      }
    }
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
      jsonPreviewTruncated ? create('div', { className: 'dfv-cap' },
        T('files.jsonTruncated', { n: JSON_PREVIEW_MAX_CHARS })) : null,
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
    if (active.loaded && !active.editing && !active.dirty && !active.saving) {
      buttons.push(create('button', {
        type: 'button',
        className: 'dfv-btn',
        title: T('files.downloadTitle'),
        onClick: function () { downloadFile(active.path) },
      },
        T('menu.download'),
      ))
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

  return {
    codeMirrorLanguage: codeMirrorLanguage,
    jsonColorNodes: jsonColorNodes,
    absolutizeMarkdownImages: absolutizeMarkdownImages,
    TextEditor: TextEditor,
    MarkdownPreview: MarkdownPreview,
    PdfPreview: PdfPreview,
    NotebookPreview: NotebookPreview,
    JsonPreview: JsonPreview,
    DelimitedPreview: DelimitedPreview,
    CodeWithLines: CodeWithLines,
    FileContent: FileContent,
    FileToolbar: FileToolbar,
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_PREVIEW_RENDERERS__ = { createPreviewRenderers }
