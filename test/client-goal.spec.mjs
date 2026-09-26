// dsh-soup 客户端渲染测试：
// 验证 Session log 与空白会话两处资源管理器入口，以及多行 GoalBar
// （复用原生 goal projection + 动作动词）的展示与按钮状态机。
// 测试场景：active / paused / blocked / 无目标 / 已完成 / 编辑态。
import { readFileSync } from 'node:fs'

// ---- 可编程 React stub：按 hook 顺序预置状态 ----
let hookStates = []
let hookIndex = 0
let effects = []
const React = {
  createElement: (type, props, ...children) => ({
    type, props: props || {},
    children: children.filter((c) => c !== false && c !== null && c !== undefined),
  }),
  useState: (init) => {
    const i = hookIndex++
    if (hookStates[i] === undefined) {
      hookStates[i] = [typeof init === 'function' ? init() : init, () => {}]
    }
    return hookStates[i]
  },
  useRef: (init) => {
    const i = hookIndex++
    if (hookStates[i] === undefined) hookStates[i] = { current: init }
    return hookStates[i]
  },
  useEffect: (fn, deps) => { effects.push({ fn, deps }) },
  useReducer: (reducer, initial) => {
    const i = hookIndex++
    if (hookStates[i] === undefined) hookStates[i] = [initial, () => {}]
    return hookStates[i]
  },
}
function resetHooks(seed) {
  hookStates = seed
  hookIndex = 0
  effects = []
}

// ---- 加载客户端 bundle ----
globalThis.window = {}
let loadedFactory = null
globalThis.window.__ModuleLoader__ = { load: (spec) => { loadedFactory = spec.factory } }
await import('../lib/client.js')
if (!loadedFactory) throw new Error('module loader did not capture factory')

// ui-primitives 桩：验证 dsh-soup 对 MarkdownText 的可选接线
function MarkdownTextStub(props) {
  return { type: 'div', props: { className: 'md-stub', children: [props.text] } }
}
const factoryModule = loadedFactory((name) => {
  if (name === 'react') return React
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: MarkdownTextStub }
  throw new Error('unexpected require: ' + name)
})

// apply 注册 goal dock 到 slots
const registered = []
const ctx = {
  slots: {
    inject: (name, cb) => cb(),
    register: (reg, renderFn) => {
      registered.push({ reg, renderFn })
      return () => {}
    },
  },
  layout: { isOpen: () => false },
  sessions: { binding: () => ({ session: { projections: { faceOf: () => undefined } } }) },
  remote: { goals: { edit: () => Promise.resolve({ ok: true }), pause: () => Promise.resolve({ ok: true }), resume: () => Promise.resolve({ ok: true }), clear: () => Promise.resolve({ ok: true }) } },
  timer: { interval: () => () => {} },
  // i18n stub：register 吸收词典；bind 返回翻译函数（返回 key 本身，
  // 断言即可验证「组件走 T('key') 而非硬编码中文」的接线）
  locale: { register: () => {}, bind: () => (key) => key },
  effect: (fn) => { const d = fn(); return () => { if (d) d() } },
}
const applyFn = factoryModule.apply || factoryModule.default
if (applyFn) applyFn(ctx)
else throw new Error('apply not found')

const goalReg = registered.find((r) => r.reg && r.reg.id === 'goal')
if (!goalReg) throw new Error('goal dock not registered')
if (goalReg.reg.locale !== 'goal') throw new Error('goal dock must use native goal locale')
const goalRender = goalReg.renderFn

// ---- 资源管理器入口：普通会话在 Session log 右侧 ----
const headerToggle = registered.find((r) => r.reg && r.reg.id === 'dsh-soup-toggle')
if (!headerToggle) throw new Error('session-header explorer toggle not registered')
if (headerToggle.reg.name !== 'conversation.session.header.utilities') {
  throw new Error('explorer toggle must use conversation.session.header.utilities')
}
resetHooks([false, { current: null }])
const headerComponent = headerToggle.renderFn({
  sessionId: 's1',
  useSessions: (selector) => selector({ byId: { s1: { cwd: '/tmp/demo' } } }),
})
const headerElement = headerComponent.type(headerComponent.props)
if (!headerElement.props.className.includes('expl-tool')) {
  throw new Error('session-header explorer toggle must keep toolbar styling')
}
if (headerElement.props['aria-label'] !== 'explorer.label') {
  throw new Error('session-header explorer toggle must use the i18n label key: ' + headerElement.props['aria-label'])
}

// ---- 资源管理器入口：空白会话在输入框上方、控件行右端 ----
const heroToggle = registered.find((r) => r.reg && r.reg.id === 'dsh-soup-hero-toggle')
if (!heroToggle) throw new Error('hero explorer toggle not registered')
if (heroToggle.reg.name !== 'conversation.input.dock') {
  throw new Error('hero explorer toggle must use conversation.input.dock')
}
const renderHero = (session) => {
  resetHooks([false])
  const component = heroToggle.renderFn({
    sessionId: 's1',
    session,
    useSessions: (selector) => selector({ byId: { s1: { cwd: '/tmp/demo' } } }),
  })
  return component.type(component.props)
}
const heroElement = renderHero({
  blank: true,
  composerPhase: 'blank',
  cwd: '/tmp/demo',
})
if (!heroElement || heroElement.props.className !== 'expl-hero-dock') {
  throw new Error('blank session needs the hero explorer dock')
}
if (!heroElement.children[0].props.className.includes('expl-tool')) {
  throw new Error('hero explorer toggle must use toolbar styling')
}
if (renderHero({ blank: false, composerPhase: 'active', cwd: '/tmp/demo' }) !== null) {
  throw new Error('hero explorer toggle must hide once Session log exists')
}

// 渲染辅助：goalRender 返回 { type: GoalDock, props }，递归调用直到得到原生 DOM 元素树
function renderCard(props) {
  let el = goalRender(props)
  if (el === null) return null
  // 递归展开函数组件（GoalDock -> GoalBar -> div）
  while (el && typeof el.type === 'function') {
    el = el.type(el.props)
  }
  return el
}

// ---- DOM 断言辅助 ----
function flattenText(node, out = []) {
  if (node == null || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) flattenText(c, out); return out }
  // textarea/input 的值在 props.value 而非 children
  if (node.props && typeof node.props.value === 'string') out.push(node.props.value)
  if (node.children) flattenText(node.children, out)
  return out
}
function attrList(node, out = []) {
  if (node == null || node === false || node === true) return out
  if (Array.isArray(node)) { for (const c of node) attrList(c, out); return out }
  if (node && node.props && node.props['aria-label']) out.push(node.props['aria-label'])
  if (node && node.children) attrList(node.children, out)
  return out
}

// ---- 默认 hook seed（editing=false, draft='', pending=false, error=null, cleared=null, pendingRef=false）----
function defaultHooks() {
  return [
    [false, () => {}],  // editing
    ['', () => {}],     // draft
    [false, () => {}],  // pending
    [null, () => {}],   // actionError
    [null, () => {}],   // clearedGoalId
    { current: false }, // pendingRef
    { current: null },  // textareaRef
  ]
}

// ---- 场景 1：active goal -> 显示标签 + objective + 暂停/编辑/清除 ----
resetHooks(defaultHooks())
const card1 = renderCard({ useProjection: () => ({ goal: { id: 'g1', revision: 1, objective: '完成目标', phase: 'active', maxGoalRounds: 10 }, roundsStarted: 2 }) })
if (card1 === null) throw new Error('active goal should render')
const text1 = flattenText(card1).join(' ')
if (!text1.includes('phase.active')) throw new Error('missing phase label: ' + text1)
if (!text1.includes('2/10')) throw new Error('missing rounds meta: ' + text1)
if (!text1.includes('完成目标')) throw new Error('missing objective: ' + text1)
const labels1 = attrList(card1)
if (!labels1.includes('action.pause')) throw new Error('active should show pause: ' + JSON.stringify(labels1))
if (labels1.includes('action.resume')) throw new Error('active should NOT show resume')
if (!labels1.includes('action.edit')) throw new Error('missing edit')
if (!labels1.includes('action.clear')) throw new Error('missing clear')

// ---- 场景 2：paused goal -> 恢复按钮，无暂停 ----
resetHooks(defaultHooks())
const card2 = renderCard({ useProjection: () => ({ goal: { id: 'g2', revision: 1, objective: '暂停目标', phase: 'paused' } }) })
const labels2 = attrList(card2)
if (!labels2.includes('action.resume')) throw new Error('paused should show resume: ' + JSON.stringify(labels2))
if (labels2.includes('action.pause')) throw new Error('paused should NOT show pause')

// ---- 场景 3：blocked goal -> 无暂停/恢复，有编辑/清除 ----
resetHooks(defaultHooks())
const card3 = renderCard({ useProjection: () => ({ goal: { id: 'g3', revision: 1, objective: '受阻目标', phase: 'blocked', blockedReason: { code: 'test', message: '原因' } } }) })
const labels3 = attrList(card3)
if (labels3.includes('action.pause') || labels3.includes('action.resume')) throw new Error('blocked should have no pause/resume: ' + JSON.stringify(labels3))
if (!labels3.includes('action.edit')) throw new Error('blocked should show edit')

// ---- 场景 4：无目标 -> null ----
resetHooks(defaultHooks())
const card4 = renderCard({ useProjection: () => null })
if (card4 !== null) throw new Error('null goal should render nothing')

// ---- 场景 5：已完成 -> null ----
resetHooks(defaultHooks())
const card5 = renderCard({ useProjection: () => ({ goal: { id: 'g5', revision: 1, objective: '完成', phase: 'complete' } }) })
if (card5 !== null) throw new Error('complete goal should render nothing')

// ---- 场景 6：编辑态 -> textarea + 保存/取消 ----
resetHooks([
  [true, () => {}],   // editing = true
  ['编辑中的目标', () => {}], // draft
  [false, () => {}],  // pending
  [null, () => {}],   // actionError
  [null, () => {}],   // clearedGoalId
  { current: false }, // pendingRef
  { current: null },  // textareaRef
])
const card6 = renderCard({ useProjection: () => ({ goal: { id: 'g6', revision: 1, objective: '旧目标', phase: 'active' } }) })
const text6 = flattenText(card6).join(' ')
if (!text6.includes('编辑中的目标')) throw new Error('edit view should show draft: ' + text6)
const labels6 = attrList(card6)
if (!labels6.includes('action.save')) throw new Error('edit view should show save: ' + JSON.stringify(labels6))
if (!labels6.includes('action.cancel')) throw new Error('edit view should show cancel: ' + JSON.stringify(labels6))

// ---- 场景 6b：编辑框自动增高，无自身滚动条 / 拖拽块 ----
function findNodeByType(node, type, out = []) {
  if (node == null || node === false || node === true) return out
  if (Array.isArray(node)) { for (const child of node) findNodeByType(child, type, out); return out }
  if (node.type === type) out.push(node)
  if (node.children) findNodeByType(node.children, type, out)
  return out
}
const textarea6 = findNodeByType(card6, 'textarea')[0]
if (!textarea6 || !textarea6.props.ref) throw new Error('edit textarea should use an auto-height ref')
// 重构拆分后，客户端源码分布在 main 与 client/ 各模块；断言覆盖拼接后的
// 全量客户端源码（等价于旧单文件 main 的检查范围，不因拆分而削弱）。
const clientSource = [
  'lib/client.main.js',
  'lib/client/file-address.js',
  'lib/client/preview-renderers.js',
  'lib/client/speed-badge.js',
  'lib/client/goal-bar.js',
  'lib/client/files-store.js',
  'lib/client/files-view.js',
  'lib/client/explorer-data.js',
  'lib/client/explorer-view.js',
].map((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n')
const htmlPreviewSource = readFileSync(new URL('../lib/client/html-preview.js', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../lib/client/styles.js', import.meta.url), 'utf8')
const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
try { new (await import('node:vm')).Script(clientBundle, { filename: 'lib/client.js' }) }
catch (error) { throw new Error('lib/client.js must stay a classic-script bundle: ' + error.message) }
if (!clientSource.includes("name: 'conversation.session.header.actions', id: 'dsh-speed-badge'")) throw new Error('speed badge must ride the session header actions slot')
if (!clientSource.includes("slots.inject('conversation.session.header.actions'")) throw new Error('speed badge entry must be bound to session scope via slots.inject (two-phase register)')
if (!clientSource.includes("rpc('speed-status'")) throw new Error('speed badge must poll the speed-status action')
if (!clientSource.includes("status.phase === 'waiting'")) throw new Error('speed badge must render the waiting phase')
if (!stylesSource.includes('resize:none;overflow:hidden')) throw new Error('edit textarea must disable resize and scrollbar')
if (!clientSource.includes('Math.max(64, input.scrollHeight)')) throw new Error('edit textarea must grow from scrollHeight')
if (!stylesSource.includes('calc(var(--dsh-composer-side-clearance) + 12px)')) {
  throw new Error('hero explorer toggle must clear the input card corner')
}
if (!clientSource.includes('function setHeroDetailsWidth') || !clientSource.includes('setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)')) {
  throw new Error('hero explorer toggle must open the blank-session details grid directly')
}
const closeLabelIndex = clientSource.indexOf("'aria-label': T('explorer.closePanel')")
const closeHandlerSource = clientSource.slice(Math.max(0, closeLabelIndex - 500), closeLabelIndex)
if (closeLabelIndex < 0 || !closeHandlerSource.includes('layout.closeDetails()') || !closeHandlerSource.includes('setHeroDetailsWidth(event.currentTarget, 0)')) {
  throw new Error('explorer close button must also close the blank-session details grid directly')
}

// ---- 场景 7：多行 objective 不被截断（无 text-overflow:ellipsis）----
resetHooks(defaultHooks())
const longObjective = '第一行\n第二行\n第三行'
const card7 = renderCard({ useProjection: () => ({ goal: { id: 'g7', revision: 1, objective: longObjective, phase: 'active' } }) })
const text7 = flattenText(card7).join(' ')
if (!text7.includes('第一行')) throw new Error('multi-line objective missing line 1: ' + text7)
if (!text7.includes('第二行')) throw new Error('multi-line objective missing line 2: ' + text7)
if (!text7.includes('第三行')) throw new Error('multi-line objective missing line 3: ' + text7)

// ---- 文件标签页：预览 + CodeMirror 6 编辑器接线 ----
if (!clientSource.includes("require('@codemirror/view')")) throw new Error('editor must use CodeMirror view')
if (!clientSource.includes("require('@codemirror/state')")) throw new Error('editor must use CodeMirror state')
if (!clientSource.includes('new EditorView')) throw new Error('editor must create a CodeMirror EditorView')
if (!clientSource.includes('EditorView.lineNumbers()')) throw new Error('editor must render native CodeMirror line numbers')
if (clientSource.includes('scrollPastEnd')) throw new Error('editor must stop at the real document bottom like preview mode')
if (!clientSource.includes("{ key: 'Mod-s'")) throw new Error('editor must keep Mod-S save')
if (!clientSource.includes('function codeMirrorLanguage')) throw new Error('editor language dispatch missing')
if (!clientSource.includes('function scheduleAutoSave')) throw new Error('auto save scheduling missing')
if (!clientSource.includes('AUTO_SAVE_DELAY_MS = 5000')) throw new Error('auto save delay must be five seconds')
if (!clientSource.includes('function manuallySaveFile')) throw new Error('manual save must be distinguishable from auto-save')
if (!clientSource.includes('function showSavedIndicator')) throw new Error('manual save success indicator missing')
if (!clientSource.includes("T('files.saved')")) throw new Error('saved indicator label missing')
if (!clientSource.includes('currentSignature.m === entry.baseMtime')) {
  throw new Error('auto refresh must ignore signatures produced by the editor itself')
}
if (!clientBundle.includes('@lezer/highlight')) throw new Error('bundled editor must include Lezer highlight tags')
if (!clientBundle.includes('PREVIEW_HIGHLIGHT_STYLE')) throw new Error('bundled editor must use preview-aligned highlighting')
if (!clientBundle.includes('PREVIEW_JSON_HIGHLIGHT_STYLE')) throw new Error('bundled JSON editor must use JSON preview highlighting')
if (!clientBundle.includes('body[data-ds-dark-theme] .dfv-cm-editor')) {
  throw new Error('bundled editor must follow the DSH light/dark theme marker')
}
if (!clientBundle.includes('--dsh-soup-code-cursor:#1f2328') || !clientBundle.includes('--dsh-soup-code-cursor:#f9fafb')) {
  throw new Error('bundled editor must provide light and dark cursor palettes')
}
if (!clientBundle.includes('.cm-cursor{border-left-color:var(--dsh-soup-code-cursor)!important;}')) {
  throw new Error('bundled editor must style the CodeMirror cursor')
}
if (!clientSource.includes("color: 'var(--dsh-soup-code-variable)'") || !clientSource.includes("color: 'var(--dsh-soup-code-function)'")) {
  throw new Error('bundled editor must use theme-aware variable and function colors')
}
if (!clientSource.includes("color: 'var(--dsh-soup-json-property)'") || !clientSource.includes("color: 'var(--dsh-soup-json-literal)'")) {
  throw new Error('bundled JSON editor must use theme-aware JSON colors')
}
if (!clientBundle.includes('padding:0 8px 0 12px')) throw new Error('bundled editor gutter must match preview padding')
if (!clientBundle.includes('create(CodeWithLines, { text }, create(JsonPreview, { text }))') && !clientBundle.includes('create2(CodeWithLines, { text }, create2(JsonPreview, { text }))')) {
  throw new Error('bundled JSON preview must render line numbers')
}
if (!clientSource.includes('JSON_PREVIEW_MAX_CHARS = 300000')) {
  throw new Error('JSON preview needs a bounded text size')
}
if (!clientSource.includes('text.slice(0, JSON_PREVIEW_MAX_CHARS)')) {
  throw new Error('oversized JSON preview must render only a bounded prefix')
}
if (!clientSource.includes("T('files.jsonTruncated', { n: JSON_PREVIEW_MAX_CHARS })")) {
  throw new Error('oversized JSON preview needs a truncation notice')
}
if (!htmlPreviewSource.includes("sandbox: 'allow-scripts allow-popups allow-forms allow-modals'")) {
  throw new Error('html preview must sandbox scripts without allow-same-origin')
}
if (!htmlPreviewSource.includes('function packHtmlPreview')) throw new Error('html preview must pack same-directory static assets')
if (!htmlPreviewSource.includes("rpc('read-related'")) throw new Error('html preview must read related assets through the host RPC')
if (!htmlPreviewSource.includes('function inlinePackedHtml')) throw new Error('html preview must inline packed local resources for Desktop compatibility')
if (!htmlPreviewSource.includes("script.removeAttribute('src')")) throw new Error('html preview must preserve classic script ordering by inlining')
if (!htmlPreviewSource.includes("'data-html-preview-fallback': true")) throw new Error('html preview must retain the legacy fallback')
if (!htmlPreviewSource.includes('return bundle.html')) throw new Error('external-only HTML must retain its original srcDoc context')
if (!htmlPreviewSource.includes('MAX_ASSETS = 64') || !htmlPreviewSource.includes('TOTAL_MAX_BYTES = 32 * 1024 * 1024')) {
  throw new Error('html preview must retain official resource limits')
}
if (!htmlPreviewSource.includes('IMAGE_DATA_MIME') || !htmlPreviewSource.includes(';base64,')) {
  throw new Error('html preview must inline same-directory relative images as data URLs')
}
if (!htmlPreviewSource.includes("'img[src],source[src],video[poster],input[type=\"image\"][src]'")) {
  throw new Error('html preview must cover relative image elements (img/source/video poster)')
}
if (!htmlPreviewSource.includes('img[srcset],source[srcset]')) {
  throw new Error('html preview must inline responsive srcset image candidates')
}
if (!htmlPreviewSource.includes("querySelectorAll('style')") || !htmlPreviewSource.includes("querySelectorAll('[style]'")) {
  throw new Error('html preview must inline relative background url() images in inline CSS')
}
if (!clientSource.includes('function parseDelimited')) throw new Error('csv preview needs the RFC4180 parser')
if (!clientSource.includes('function previewKind')) throw new Error('preview dispatch by extension missing')
if (!clientSource.includes('jsonColorNodes')) throw new Error('json preview colorizer missing')
if (!clientSource.includes('create(MarkdownText, { text: md })')) throw new Error('markdown preview must reuse DSH MarkdownText')
if (!clientSource.includes('function localPathImageUrl')) throw new Error('markdown preview needs the local-path image vocabulary')
if (!clientSource.includes("new URL('api/file?path=' + encodeURIComponent(abs), document.baseURI).href")) {
  throw new Error('markdown relative images must resolve through the official api/file route')
}
if (!clientSource.includes('pathImages: pathImages')) throw new Error('markdown preview must pass the pathImages vocabulary to MarkdownText')
if (clientSource.includes('dsh-soup/img?p=')) throw new Error('markdown images must not depend on the dsh-soup img endpoint (rejected by sanitizeUrl under dsh-app://)')
if (!clientSource.includes("rpc('mtime'")) throw new Error('auto refresh must poll the mtime probe action')
if (!clientSource.includes("rpc('mtime', { paths: paths, sessionId: getActiveSessionId() })")) throw new Error('mtime probe must carry the active session boundary')
if (!clientSource.includes('(attempt || 0) < 6')) throw new Error('explorer must retry session-attach window with extended backoff')
if (!clientSource.includes('setTimeout(r, 1000)')) throw new Error('explorer retry backoff must be 1s per attempt')
if (!clientSource.includes('function autoRefreshTick')) throw new Error('auto refresh tick missing')
if (!clientSource.includes('AUTO_REFRESH_MS = 3000')) throw new Error('auto refresh interval missing')
if (!clientSource.includes("if (!getState().open && getState().files.list.length === 0) return 'idle'")) throw new Error('auto refresh must idle when panel closed and no previews')
if (!clientSource.includes('lastMtimes = {}')) throw new Error('session switch must reset mtime baselines')
if (!clientSource.includes('function autoHeartbeat')) throw new Error('auto refresh heartbeat missing')
if (!clientSource.includes('AUTO_HEARTBEAT_MS = 1000')) throw new Error('auto refresh heartbeat interval missing')
if (!clientSource.includes('AUTO_BACKOFF_MAX_MS = 60000')) throw new Error('auto refresh backoff cap missing')
if (!clientSource.includes('function refreshAll')) throw new Error('manual refresh-all missing')
if (!clientSource.includes('var expandedDirs = new Set()')) throw new Error('expanded folders must be stored across tree refreshes')
if (!clientSource.includes('var expandedDirsCwd = null')) throw new Error('expanded-folder state must be scoped to the current project cwd')
if (!clientSource.includes('async function restoreExpandedChildren(nodes)')) throw new Error('refresh must recursively restore expanded folders')
if (!clientSource.includes('await restoreExpandedChildren(items)')) {
  throw new Error('normal refresh must restore expanded-folder state')
}
if (clientSource.includes("expanded.push({ path: n.path, open: !!n.open })")) {
  throw new Error('refreshAll must use the shared recursive expansion restore, not a local one-shot snapshot')
}
if (!clientSource.includes('if (node.open) expandedDirs.add(node.path)') ||
    !clientSource.includes('else expandedDirs.delete(node.path)')) {
  throw new Error('folder toggles must update persistent expanded paths')
}
if (!clientSource.includes('forgetExpandedPaths(trashed)')) throw new Error('trashed folders must be removed from expansion state')
if (!clientSource.includes('if (isDir) rekeyExpandedPaths(path, dest)')) throw new Error('renamed folders must retain nested expansion state')
if (!clientSource.includes('if (item.isDir) rekeyExpandedPaths(item.from, item.to)')) {
  throw new Error('moved folders must retain nested expansion state')
}
if (!clientSource.includes("title: T('explorer.refreshTitle')")) throw new Error('refresh button must use the i18n title key')
if (!clientSource.includes("title: T('explorer.newFolderTitle')")) throw new Error('new-folder button must use the i18n title key')
if (!stylesSource.includes('export var ICON_NEW_FOLDER')) throw new Error('toolbar new-folder svg icon missing')
if (!clientSource.includes("startNew(getState().cwd, true)")) throw new Error('toolbar new-folder button must use the shared inline creation flow')
const i18nSource = readFileSync(new URL('../lib/client/i18n.js', import.meta.url), 'utf8')
if (!i18nSource.includes("export var NS = 'dsh-soup'")) throw new Error('i18n namespace missing')
if (!i18nSource.includes('export var DICT = {')) throw new Error('i18n dictionary missing')
if (!clientSource.includes("ctx.locale.register(NS, DICT)")) throw new Error('i18n dictionary must be registered')
if (!clientSource.includes('T = ctx.locale.bind(NS)')) throw new Error('module-level translator must bind')
if (!clientSource.includes("locale: NS")) throw new Error('slots must opt into the locale face')
if (!stylesSource.includes('export var ICON_REFRESH')) throw new Error('toolbar refresh svg icon missing')
if (clientSource.includes('dangerouslySetInnerHTML: { __html: ICON_CLOSE }')) throw new Error('close button must not reuse ICON_CLOSE (collides with goalIcon var)')
if (!clientSource.includes('expl-menu-ico')) throw new Error('context-menu refresh item must use the svg icon')
if (!stylesSource.includes(".expl-btn{width:26px;height:26px;")) throw new Error('explorer header buttons must be 26px icon buttons')
if (!stylesSource.includes('.dfv-btn{flex:none;display:inline-flex')) throw new Error('preview reload button must be flex icon+label')
if (!clientSource.includes('var DETAILS_MIN = 300')) throw new Error('details width must use host contract minimum')
if (!clientSource.includes('var DETAILS_MAX = 520')) throw new Error('details width must use host contract maximum')
if (!clientSource.includes('var DETAILS_DEFAULT = 360')) throw new Error('details width must use host contract default')
if (!clientSource.includes('widthRef.current = last')) throw new Error('details drag must adopt host width instead of resetting it')
if (!clientSource.includes('if (last < DETAILS_MIN || last > DETAILS_MAX)')) throw new Error('rightbar width must clamp the official viewport-ratio default')
if (!clientSource.includes('setFrameWidth(DETAILS_DEFAULT)')) throw new Error('rightbar width must initialize to the dsh-soup default')
if (!clientSource.includes("slots.inject('rightbar'")) throw new Error('dsh-soup must replace the official rightbar occupant')
if (!clientSource.includes("name: 'rightbar', priority: -1")) throw new Error('rightbar replacement must have lower priority than the official occupant')
if (!clientSource.includes("slots.inject('rightbar'") || !clientSource.includes("create(PreviewOverlay)")) throw new Error('rightbar replacement must keep the blank-session preview overlay')
if (!clientSource.includes('getLayout().openRightbar(true, false)')) throw new Error('rightbar toggle must use the 0.1.5 layout API')
if (!clientSource.includes('getLayout().closeRightbar()')) throw new Error('rightbar close must use the 0.1.5 layout API')
if (!clientSource.includes('[data-sidebar-right-expand]')) throw new Error('official rightbar expand button must be unified with dsh-soup')
if (!clientSource.includes('stopImmediatePropagation')) throw new Error('official rightbar action must be intercepted')
if (!stylesSource.includes('[data-sidebar-right-expand],[data-sidebar-right-expand-placeholder]{display:none!important;}')) throw new Error('official rightbar expand control must be hidden')
if (!clientSource.includes("getAttribute('data-dsh-soup-preview') === '1'") || !stylesSource.includes('data-dsh-soup-preview="1"')) throw new Error('reading-mode css marker missing')
if (!stylesSource.includes(".dfv-header{position:sticky;top:0;")) throw new Error('preview tabs/path header must stay sticky')
if (!clientSource.includes("create('div', { className: 'dfv-header' }")) throw new Error('preview tabs/path header wrapper missing')
if (!clientSource.includes('function usePreviewReadingMode')) throw new Error('reading-mode hook missing')
if (!stylesSource.includes('.wSkVaW_composerSeat')) throw new Error('reading-mode must hide composer seat')
if (!stylesSource.includes('.FJxK0a_root')) throw new Error('reading-mode must hide stats line')
if (!clientSource.includes('create(CodeBlock, { code: text, lang: lang })')) throw new Error('code preview must reuse DSH CodeBlock (shiki)')
if (!clientSource.includes('CODE_HIGHLIGHT_MAX_CHARS')) throw new Error('code highlight needs a size guard')
if (!clientSource.includes("CSV_MAX_ROWS = 500")) throw new Error('csv preview must cap rendered rows')
if (!clientSource.includes('FILES_MAX_OPEN = 5')) throw new Error('preview tabs must cap at 5 (FIFO)')
if (!clientSource.includes('function pruneFilesToScope')) throw new Error('session switch must prune out-of-scope previews')
if (!clientSource.includes('pruneFilesToScope(getState().files, cwd)')) throw new Error('trackSession must apply scope pruning')
if (!clientSource.includes('function NotebookPreview')) throw new Error('ipynb preview component missing')
if (!clientSource.includes("ext === 'ipynb'")) throw new Error('previewKind must map .ipynb to notebook')
const fileIconsSource = readFileSync(new URL('../lib/client/file-icons.js', import.meta.url), 'utf8')
if (!fileIconsSource.includes("py: 'py', rb: 'rb', go: 'go', rs: 'rs'")) throw new Error('code language table must cover common languages')
const fileIcons = await import('../lib/client/file-icons.js')
for (const name of ['a.md', 'x.ts', 'y.lua', 'LICENSE', 'noext', 'z.jpg']) {
  const svg = fileIcons.iconSvgFor({ type: 'file', name })
  if (typeof svg !== 'string' || svg.length === 0) throw new Error('iconSvgFor must resolve: ' + name)
}
if (fileIcons.iconSvgFor({ type: 'directory', name: 'd', open: true }) !== fileIcons.NB_SVG.folderFavorite) {
  throw new Error('open directory must use folderFavorite')
}
if (!fileIconsSource.includes('export function iconSvgFor')) throw new Error('jupyterlab-style icon resolver missing')
if (!fileIconsSource.includes('node.open ? NB_SVG.folderFavorite : NB_SVG.folder')) throw new Error('directory icon must switch on expanded state')
if (!fileIconsSource.includes('folderFavorite: ')) throw new Error('folder-favorite svg missing')
if (!fileIconsSource.includes('jp-notebook-icon-color')) throw new Error('notebook filetype svg (JupyterLab) missing')
if (!clientSource.includes('dangerouslySetInnerHTML: { __html: iconSvgFor(node) }')) throw new Error('tree rows must render svg icons')
if (!stylesSource.includes('.expl-icon svg{width:16px;height:16px;display:block;}')) throw new Error('svg icon sizing css missing')
if (!clientSource.includes("function copyPath(target)")) throw new Error('copyPath must take explicit node (menu closes before click)')
if (!clientSource.includes("T('menu.download')")) throw new Error('download actions must use the i18n label key')
if (!i18nSource.includes("'menu.download': '⬇ 下载'")) throw new Error('download actions must mirror the upload arrow glyph')
if (!clientSource.includes("T('menu.upload')")) throw new Error('folder context menu must expose upload action')
if (!clientSource.includes('chooseUploadDir(node.path)')) throw new Error('folder upload must target the selected directory')
if (!clientSource.includes('uploadFiles(targetDir || getState().cwd, files)')) throw new Error('picker upload must use its selected target directory')
if (!clientSource.includes('sessionId: getActiveSessionId()')) throw new Error('uploads must stay within the active session boundary')
if (!i18nSource.includes("'menu.upload': '⬆ 上传文件'")) throw new Error('folder upload menu must have Chinese translation')
if (!clientSource.includes("T('files.downloadTitle')")) throw new Error('preview download button needs a tooltip')
if (!clientSource.includes('downloadFile(active.path)')) throw new Error('preview download button must use the active file action')
if (!clientSource.includes('active.loaded && !active.editing && !active.dirty && !active.saving')) {
  throw new Error('preview download button must hide during editing or saving')
}
if (!clientSource.includes("T('explorer.uploaded', { n: okCount })")) throw new Error('upload completion must interpolate the uploaded count')
if (!clientSource.includes("T('explorer.downloaded', { n: okCount })")) throw new Error('download completion must interpolate the downloaded count')
if (!i18nSource.includes("'explorer.overwriteConfirm': '文件“{name}”已存在，是否覆盖？'")) throw new Error('overwrite confirmation must have Chinese translation')
if (!i18nSource.includes("'explorer.overwriteConfirm': 'The file \"{name}\" already exists. Overwrite it?'")) throw new Error('overwrite confirmation must have English translation')
if (!clientSource.includes("await askOverwrite(f.name)")) throw new Error('overwrite confirmation must use the custom i18n dialog')
if (!i18nSource.includes("'explorer.overwrite': '覆盖'")) throw new Error('overwrite button must have Chinese translation')
if (!i18nSource.includes("'explorer.overwrite': 'Overwrite'")) throw new Error('overwrite button must have English translation')
if (!clientSource.includes("T('explorer.cancel')")) throw new Error('cancel button must use i18n')
if (!clientSource.includes("function downloadFile(path)")) throw new Error('downloadFile missing')
if (!clientSource.includes('function nbPickMime')) throw new Error('notebook output mime preference missing')




const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const hostFileViewSource = readFileSync(new URL('../lib/host/file-view.js', import.meta.url), 'utf8')
if (!hostFileViewSource.includes('NB_MAX_BYTES = 20 * 1024 * 1024')) throw new Error('notebook cap must be 20MB')

console.log('CLIENT GOAL OK: phase labels, button state machine, no-goal/complete null, edit view, multi-line objective, files preview + edit (md/html/json/csv)')
