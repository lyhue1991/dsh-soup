// dsh-tree GoalBar 客户端渲染测试：
// 验证多行 GoalBar（复用原生 goal projection + 动作动词）的展示与按钮状态机。
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

const factoryModule = loadedFactory((name) => {
  if (name === 'react') return React
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

// ---- 场景 7：多行 objective 不被截断（无 text-overflow:ellipsis）----
resetHooks(defaultHooks())
const longObjective = '第一行\n第二行\n第三行'
const card7 = renderCard({ useProjection: () => ({ goal: { id: 'g7', revision: 1, objective: longObjective, phase: 'active' } }) })
const text7 = flattenText(card7).join(' ')
if (!text7.includes('第一行')) throw new Error('multi-line objective missing line 1: ' + text7)
if (!text7.includes('第二行')) throw new Error('multi-line objective missing line 2: ' + text7)
if (!text7.includes('第三行')) throw new Error('multi-line objective missing line 3: ' + text7)

console.log('CLIENT GOAL OK: phase labels, button state machine, no-goal/complete null, edit view, multi-line objective')
