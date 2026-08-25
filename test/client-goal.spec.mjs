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
if (headerElement.props['aria-label'] !== '项目资源管理器') {
  throw new Error('session-header explorer toggle is missing its accessible label')
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
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
if (!clientSource.includes('resize:none;overflow:hidden')) throw new Error('edit textarea must disable resize and scrollbar')
if (!clientSource.includes('Math.max(64, input.scrollHeight)')) throw new Error('edit textarea must grow from scrollHeight')
if (!clientSource.includes('calc(var(--dsh-composer-side-clearance) + 12px)')) {
  throw new Error('hero explorer toggle must clear the input card corner')
}
if (!clientSource.includes('function setHeroDetailsWidth') || !clientSource.includes('setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)')) {
  throw new Error('hero explorer toggle must open the blank-session details grid directly')
}
const closeLabelIndex = clientSource.indexOf("'aria-label': '关闭资源管理器'")
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

// ---- 文件标签页：只读预览（无编辑/保存），四种格式渲染器接线 ----
if (clientSource.includes("rpc('write'")) throw new Error('preview-only: client must not call write')
if (clientSource.includes("action: 'write'")) throw new Error('preview-only: no write action usage')
if (!clientSource.includes("sandbox: 'allow-scripts allow-popups allow-forms allow-modals'")) throw new Error('html preview must sandbox scripts without allow-same-origin')
if (!clientSource.includes('srcDoc')) throw new Error('html preview must inject via srcDoc')
if (!clientSource.includes('function parseDelimited')) throw new Error('csv preview needs the RFC4180 parser')
if (!clientSource.includes('function previewKind')) throw new Error('preview dispatch by extension missing')
if (!clientSource.includes('jsonColorNodes')) throw new Error('json preview colorizer missing')
if (!clientSource.includes('create(MarkdownText, { text: md })')) throw new Error('markdown preview must reuse DSH MarkdownText')
if (!clientSource.includes('absolutizeMarkdownImages')) throw new Error('markdown preview must absolutize relative image srcs')
if (!clientSource.includes('/api/dsh-soup/img?p=')) throw new Error('markdown relative images must point at the img endpoint')
if (!clientSource.includes("rpc('mtime'")) throw new Error('auto refresh must poll the mtime probe action')
if (!clientSource.includes('function autoRefreshTick')) throw new Error('auto refresh tick missing')
if (!clientSource.includes('AUTO_REFRESH_MS = 3000')) throw new Error('auto refresh interval missing')
if (!clientSource.includes('if (!state.open && state.files.list.length === 0) return')) throw new Error('auto refresh must idle when panel closed and no previews')
if (!clientSource.includes('lastMtimes = {}')) throw new Error('session switch must reset mtime baselines')
if (!clientSource.includes('create(CodeBlock, { code: entry.content, lang: lang })')) throw new Error('code preview must reuse DSH CodeBlock (shiki)')
if (!clientSource.includes("py: 'py', rb: 'rb', go: 'go', rs: 'rs'")) throw new Error('code language table must cover common languages')
if (!clientSource.includes('CODE_HIGHLIGHT_MAX_CHARS')) throw new Error('code highlight needs a size guard')
if (!clientSource.includes("CSV_MAX_ROWS = 500")) throw new Error('csv preview must cap rendered rows')
if (!clientSource.includes('FILES_MAX_OPEN = 5')) throw new Error('preview tabs must cap at 5 (FIFO)')
if (!clientSource.includes('function pruneFilesToScope')) throw new Error('session switch must prune out-of-scope previews')
if (!clientSource.includes('pruneFilesToScope(state.files, cwd)')) throw new Error('trackSession must apply scope pruning')
if (!clientSource.includes('function NotebookPreview')) throw new Error('ipynb preview component missing')
if (!clientSource.includes("ext === 'ipynb'")) throw new Error('previewKind must map .ipynb to notebook')
if (!clientSource.includes('function iconSvgFor')) throw new Error('jupyterlab-style icon resolver missing')
if (!clientSource.includes('node.open ? NB_SVG.folderFavorite : NB_SVG.folder')) throw new Error('directory icon must switch on expanded state')
if (!clientSource.includes('folderFavorite: ')) throw new Error('folder-favorite svg missing')
if (!clientSource.includes('jp-notebook-icon-color')) throw new Error('notebook filetype svg (JupyterLab) missing')
if (!clientSource.includes('dangerouslySetInnerHTML: { __html: iconSvgFor(node) }')) throw new Error('tree rows must render svg icons')
if (!clientSource.includes('.expl-icon svg{width:16px;height:16px;display:block;}')) throw new Error('svg icon sizing css missing')
if (!clientSource.includes("function copyPath(target)")) throw new Error('copyPath must take explicit node (menu closes before click)')
if (!clientSource.includes("label: '\u2b07 \u4e0b\u8f7d'")) throw new Error('download menu item missing')
if (!clientSource.includes("function downloadFile(path)")) throw new Error('downloadFile missing')
if (!clientSource.includes('function nbPickMime')) throw new Error('notebook output mime preference missing')




const indexSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
if (!indexSource.includes('NB_MAX_BYTES = 20 * 1024 * 1024')) throw new Error('notebook cap must be 20MB')

console.log('CLIENT GOAL OK: phase labels, button state machine, no-goal/complete null, edit view, multi-line objective, files preview-only(md/html/json/csv)')
