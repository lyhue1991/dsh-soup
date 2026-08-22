// dsh-tree GoalCard 客户端渲染测试：
// 通过 slots.register 捕获 goal 卡片的渲染函数，直接调用并断言
// token 预算 meta、状态标签、按钮状态机（active/paused/budget_limited/无目标/编辑态）。
import { fileURLToPath } from 'node:url'

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

let goalRender = null
let applyCtx = null
const factoryModule = loadedFactory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
// apply 注册 goal 卡片到 slots
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
  timer: { interval: () => () => {} },
  effect: (fn) => { const d = fn(); return () => { if (d) d() } },
}
applyCtx = factoryModule.default || factoryModule.apply || (factoryModule.exports && factoryModule.exports.apply)
if (!applyCtx && typeof factoryModule === 'function') applyCtx = factoryModule
if (!applyCtx) throw new Error('apply not found in module exports')
// 触发 apply（部分插件导出为 { apply }）
const applyFn = factoryModule.apply || factoryModule.default
if (applyFn) applyFn(ctx)
else {
  // 直接以函数形式导出时
  applyCtx(ctx)
}
const goalReg = registered.find((r) => r.reg && r.reg.id === 'goal')
if (!goalReg) throw new Error('goal card not registered')
goalRender = goalReg.renderFn

// 渲染辅助：renderFn 返回 React element descriptor {type: GoalCard, props}，需经 type() 出真实树
function renderCard(props) {
  const el = goalRender(props)
  if (el === null) return null
  return el.type(el.props)
}

// ---- DOM 断言辅助 ----
function flattenText(node, out = []) {
  if (node == null || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const c of node) flattenText(c, out); return out }
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

// ---- 场景 1：active goal，token 预算/用量 meta ----
function seedGoal(phase, extra) {
  resetHooks([
    [{ goal: Object.assign({
      id: 'g1', revision: 3, objective: '完成目标', phase,
      tokenBudget: 100000, tokensUsed: 1200, timeUsedSeconds: 65,
      blockedReason: null, activation: 'armed',
    }, extra || {}) }, () => {}],
    [false, () => {}],   // editing
    ['', () => {}],      // draft
    ['', () => {}],      // budgetDraft
    [false, () => {}],   // unlimited
    [false, () => {}],   // pending
    [null, () => {}],    // error
    { current: false },  // pendingRef
  ])
}

seedGoal('active')
const card = renderCard({ sessionId: 's1' })
if (card === null) throw new Error('active goal should render a card')
const text = flattenText(card).join(' · ')
if (!text.includes('进行中')) throw new Error('missing 进行中 label: ' + text)
if (!text.includes('1m 5s')) throw new Error('missing elapsed 1m 5s: ' + text)
if (!text.includes('1.2K / 100K t')) throw new Error('missing token meta 1.2K / 100K t: ' + text)
if (!text.includes('完成目标')) throw new Error('missing objective text: ' + text)
const labels = attrList(card)
if (!labels.includes('暂停目标')) throw new Error('active goal should show pause button: ' + JSON.stringify(labels))
if (labels.includes('恢复目标')) throw new Error('active goal should NOT show resume: ' + JSON.stringify(labels))
if (!labels.includes('清除目标')) throw new Error('missing clear button')

// ---- 场景 2：paused goal → 恢复按钮 ----
seedGoal('paused')
const card2 = renderCard({ sessionId: 's1' })
const labels2 = attrList(card2)
if (!labels2.includes('恢复目标')) throw new Error('paused should show resume: ' + JSON.stringify(labels2))
if (labels2.includes('暂停目标')) throw new Error('paused should NOT show pause')

// ---- 场景 3：budget_limited → 标签 + 无暂停/恢复按钮 ----
seedGoal('budget_limited')
const card3 = renderCard({ sessionId: 's1' })
const text3 = flattenText(card3).join(' · ')
if (!text3.includes('预算耗尽')) throw new Error('missing budget_limited label: ' + text3)
const labels3 = attrList(card3)
if (labels3.includes('暂停目标') || labels3.includes('恢复目标')) throw new Error('budget_limited should have no pause/resume: ' + JSON.stringify(labels3))
if (!labels3.includes('编辑目标')) throw new Error('budget_limited should show edit')

// ---- 场景 4：无目标 → null ----
resetHooks([
  [{ goal: null }, () => {}],
  [false, () => {}], ['', () => {}], ['', () => {}], [false, () => {}], [false, () => {}], [null, () => {}],
  { current: false },
])
if (renderCard({ sessionId: 's1' }) !== null) throw new Error('no-goal should render null')

// ---- 场景 5：未加载（viewState null）→ null ----
resetHooks([
  [null, () => {}],
  [false, () => {}], ['', () => {}], ['', () => {}], [false, () => {}], [false, () => {}], [null, () => {}],
  { current: false },
])
if (renderCard({ sessionId: 's1' }) !== null) throw new Error('loading should render null')

// ---- 场景 6：编辑态 → 含预算输入框与"无上限" ----
seedGoal('active', { tokenBudget: null }) // 无上限目标
resetHooks([
  [{ goal: { id: 'g1', revision: 3, objective: '目标', phase: 'active', tokenBudget: null, tokensUsed: 900, timeUsedSeconds: 5, activation: 'armed' } }, () => {}],
  [true, () => {}],   // editing
  ['目标', () => {}], // draft
  ['', () => {}],     // budgetDraft
  [true, () => {}],   // unlimited
  [false, () => {}],
  [null, () => {}],
  { current: false },
])
const card6 = renderCard({ sessionId: 's1' })
const text6 = flattenText(card6).join(' · ')
if (!text6.includes('无上限')) throw new Error('edit view should show 无上限: ' + text6)
if (!text6.includes('保存')) throw new Error('edit view should show 保存')

console.log('CLIENT GOAL OK: token meta, status labels, button state machine, no-goal/loading null, edit view')
