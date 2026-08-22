// dsh-tree Goal 覆盖层测试：
// 替换工具（create_goal/get_goal/update_goal，token 预算语义）、
// llm/stream token 记账、预算耗尽 → budget_limited + 暂停原生 goal、
// bridge goal-view / goal-action。
import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'

const WORK = join(tmpdir(), 'dsh-tree-goal-' + process.pid + '-' + Date.now())
await mkdir(WORK, { recursive: true })

let captured = null
let streamListener = null
const listeners = new Map()
const registeredTools = new Map()
const goalsStore = new Map() // agentId -> { goal, activation }

function makeAgent(id, events) {
  return {
    id,
    session: { events: events || [] },
    ctx: {
      tools: {
        register: (def) => {
          registeredTools.set(def.name, def)
          return () => registeredTools.delete(def.name)
        },
      },
      effect: (fn) => { const d = fn(); return () => { if (d) d() } },
    },
  }
}

const agentA = makeAgent('a1', [
  { type: 'turn/start', turn: 1 },
  { type: 'user/message', data: { source: { kind: 'user' } } },
])
const agentB = makeAgent('a2', [
  { type: 'turn/start', turn: 1 },
  { type: 'user/message', data: { source: { kind: 'goal', goalId: 'g-a2', revision: 1, round: 1 } } },
])

const agents = {
  _map: new Map([['a1', agentA], ['a2', agentB]]),
  get: (id) => agents._map.get(id),
  roots: () => [...agents._map.values()],
}

function bump(e) { e.goal.revision += 1 }
const goals = {
  get: (agent) => { const e = goalsStore.get(agent.id); return e ? { ...e.goal, activation: e.activation } : undefined },
  create: (agent, req) => {
    const prev = goalsStore.get(agent.id)
    if (prev && prev.goal.phase !== 'complete') throw new Error('goal exists')
    const goal = { id: 'g-' + agent.id, revision: 1, objective: req.objective, phase: 'active', maxGoalRounds: req.maxGoalRounds, blockedReason: null }
    goalsStore.set(agent.id, { goal, activation: 'armed' })
    return { ...goal, activation: 'armed' }
  },
  edit: (agent, ref, req) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.id !== ref.id || e.goal.revision !== ref.revision) throw new Error('bad ref')
    if (req.objective !== undefined) e.goal.objective = req.objective
    bump(e)
    return { ...e.goal, activation: e.activation }
  },
  pause: (agent, ref) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.revision !== ref.revision) throw new Error('bad ref')
    e.goal.phase = 'paused'; e.activation = 'disarmed'; bump(e)
    return { ...e.goal, activation: e.activation }
  },
  resume: (agent, ref) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.revision !== ref.revision) throw new Error('bad ref')
    e.goal.phase = 'active'; e.activation = 'armed'; bump(e)
    return { ...e.goal, activation: e.activation }
  },
  complete: (agent, ref) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.revision !== ref.revision) throw new Error('bad ref')
    e.goal.phase = 'complete'; e.activation = 'disarmed'; bump(e)
    return { ...e.goal, activation: e.activation }
  },
  block: (agent, ref, reason) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.revision !== ref.revision) throw new Error('bad ref')
    if (e.goal.phase !== 'active') throw new Error('block requires active')
    e.goal.phase = 'blocked'; e.activation = 'disarmed'; e.goal.blockedReason = reason; bump(e)
    return { ...e.goal, activation: e.activation }
  },
  clear: (agent, ref) => {
    const e = goalsStore.get(agent.id)
    if (!e || e.goal.revision !== ref.revision) throw new Error('bad ref')
    goalsStore.delete(agent.id)
    return { id: ref.id, revision: ref.revision + 1 }
  },
}

const ctx = {
  effect: (fn) => { const d = fn(); return () => { if (d) d() } },
  on: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push(fn)
    return () => {
      const arr = listeners.get(name) || []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    }
  },
  timer: { interval: () => () => {} },
  webServer: { register: (route) => { captured = route; return () => { captured = null } } },
  fs: { resolve: async (p) => ({ displayPath: p }), listDir: async () => [] },
  subprocess: { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }) }) },
  sandboxPolicy: { workspaceRoot: WORK },
  sessions: { get: () => undefined },
  agents,
  goals,
  tools: { register: () => () => {} },
}

apply(ctx)
if (!captured || captured.path !== '/api/dsh-tree') throw new Error('route not registered')
streamListener = (listeners.get('llm/stream') || [])[0]
if (!streamListener) throw new Error('llm/stream listener missing')
const createdListeners = listeners.get('agent/created') || []

// agentA/agentB 在 apply 前已入 root 列表 → load 时已安装；再补发 agent/created 幂等验证。
for (const fn of createdListeners) fn({ agent: agentA })
for (const fn of createdListeners) fn({ agent: agentB })

if (!registeredTools.has('create_goal') || !registeredTools.has('get_goal') || !registeredTools.has('update_goal')) {
  throw new Error('goal tools not registered on agent scope')
}
if (registeredTools.size !== 3) throw new Error('expected exactly 3 scoped tools, got ' + registeredTools.size)

function call(body) {
  const res = { writeHead: (c, h) => { res.code = c; res.headers = h }, end: (b) => { res.body = JSON.parse(b) } }
  const payload = JSON.stringify(body)
  captured.handler({
    on: (ev, fn) => {
      if (ev === 'data') setTimeout(() => fn(Buffer.from(payload)), 0)
      if (ev === 'end') setTimeout(() => fn(), 1)
    },
  }, res)
  return new Promise((r) => setTimeout(() => r(res), 20))
}

async function drain(stream) { for await (const _c of stream) { /* drain */ } }

// ---- create_goal：token 预算 + 原生巨大轮数 ----
const createDef = registeredTools.get('create_goal')
const getDef = registeredTools.get('get_goal')
const updDef = registeredTools.get('update_goal')

const created = await createDef.execute({ objective: '测试目标', token_budget: 1000 }, { agent: agentA })
if (!created.goal) throw new Error('create_goal returned no goal: ' + JSON.stringify(created))
if (created.goal.phase !== 'active') throw new Error('expected active phase')
if (created.goal.tokenBudget !== 1000) throw new Error('budget not stored: ' + JSON.stringify(created.goal))
if (created.goal.tokensUsed !== 0) throw new Error('tokensUsed should start at 0')
if (goalsStore.get('a1').goal.maxGoalRounds !== 2147483647) throw new Error('rounds should be huge')
if (goalsStore.get('a1').goal.id !== created.goal.id) throw new Error('native goal id mismatch')

// 重复 create 应报错
let dup = false
try { await createDef.execute({ objective: '另一个' }, { agent: agentA }) } catch (e) { dup = true }
if (!dup) throw new Error('duplicate create should throw')

// ---- get_goal ----
const g0 = await getDef.execute({}, { agent: agentA })
if (!g0.goal || g0.goal.tokensUsed !== 0) throw new Error('get_goal mismatch: ' + JSON.stringify(g0))

// ---- llm/stream 记账：usage 总 token (input+output+cache) 累加；超预算 → budget_limited + 原生暂停 ----
const stream1 = (async function* () {
  yield { type: 'usage', usage: { inputTokens: 400, outputTokens: 300, cacheReadTokens: 200, cacheWriteTokens: 100 } } // 1000
})()
await drain(streamListener({ sessionId: 'a1' }, () => Promise.resolve(stream1)))
const g1 = await getDef.execute({}, { agent: agentA })
if (g1.goal.tokensUsed !== 1000) throw new Error('tokensUsed should be 1000: ' + JSON.stringify(g1.goal))
if (g1.goal.phase !== 'budget_limited') throw new Error('expected budget_limited, got ' + g1.goal.phase)
if (goalsStore.get('a1').goal.phase !== 'paused') throw new Error('native goal should be paused')
if (goalsStore.get('a1').activation !== 'disarmed') throw new Error('native should be disarmed')

// ---- update_goal：edit 提高预算 → 状态解除；resume 恢复 ----
const e1 = await updDef.execute({ goal_id: g1.goal.id, revision: g1.goal.revision, action: 'edit', token_budget: 5000 }, { agent: agentA })
if (e1.goal.phase !== 'paused') throw new Error('after budget raise phase should stay paused (native paused): ' + JSON.stringify(e1.goal))
const e2 = await updDef.execute({ goal_id: e1.goal.id, revision: e1.goal.revision, action: 'resume' }, { agent: agentA })
if (e2.goal.phase !== 'active') throw new Error('resume failed: ' + JSON.stringify(e2.goal))
if (e2.goal.tokenBudget !== 5000) throw new Error('budget should be 5000 now')

// ---- complete / blocked（direct-human 创建，goal 轮完成）----
const agentC = makeAgent('a5', [{ type: 'turn/start', turn: 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }])
agents._map.set('a5', agentC)
for (const fn of createdListeners) fn({ agent: agentC })
const cc = await createDef.execute({ objective: 'C目标', token_budget: null }, { agent: agentC })
if (!cc.goal || cc.goal.phase !== 'active') throw new Error('create C failed: ' + JSON.stringify(cc))
// 换成 goal 轮：complete 应允许（goal round 授权）
agentC.session.events = [{ type: 'turn/start', turn: 2 }, { type: 'user/message', data: { source: { kind: 'goal' } } }]
const comp = await updDef.execute({ goal_id: cc.goal.id, revision: cc.goal.revision, action: 'complete' }, { agent: agentC })
if (comp.goal.phase !== 'complete') throw new Error('complete failed: ' + JSON.stringify(comp.goal))
// complete 后可再 create（换回 direct human）
agentC.session.events = [{ type: 'turn/start', turn: 3 }, { type: 'user/message', data: { source: { kind: 'user' } } }]
const cc2 = await createDef.execute({ objective: 'C2目标' }, { agent: agentC })
// blocked：goal 轮授权
agentC.session.events = [{ type: 'turn/start', turn: 4 }, { type: 'user/message', data: { source: { kind: 'goal' } } }]
const blocked = await updDef.execute({ goal_id: cc2.goal.id, revision: cc2.goal.revision, action: 'blocked', blocked_reason: '卡住了' }, { agent: agentC })
if (blocked.goal.phase !== 'blocked') throw new Error('blocked failed: ' + JSON.stringify(blocked.goal))
// blocked 后无 direct human 也无 goal 轮 → complete 拒绝
agentC.session.events = []
let badauth = false
try { await updDef.execute({ goal_id: cc2.goal.id, revision: blocked.goal.revision, action: 'complete' }, { agent: agentC }) } catch (e) { badauth = true }
if (!badauth) throw new Error('complete without authority should throw')

// ---- 权限：非 direct human 的 root agent 不能 create ----
const agentNH = makeAgent('a3', [{ type: 'turn/start', turn: 1 }, { type: 'user/message', data: { source: { kind: 'goal' } } }])
agents._map.set('a3', agentNH)
for (const fn of createdListeners) fn({ agent: agentNH })
let nh = false
try { await createDef.execute({ objective: 'x' }, { agent: agentNH }) } catch (e) { nh = true }
if (!nh) throw new Error('create_goal without direct human should throw')
// 不在 registry 的 agent → 拒绝
let off = false
try { await createDef.execute({ objective: 'x' }, { agent: makeAgent('ghost', []) }) } catch (e) { off = true }
if (!off) throw new Error('create_goal from unknown agent should throw')

// ---- 预算耗尽时 resume 应拒绝 ----
const agentD = makeAgent('a4', [{ type: 'turn/start', turn: 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }])
agents._map.set('a4', agentD)
for (const fn of createdListeners) fn({ agent: agentD })
const cd = await createDef.execute({ objective: 'D', token_budget: 5 }, { agent: agentD })
const s2 = (async function* () { yield { type: 'usage', usage: { inputTokens: 10 } } })()
await drain(streamListener({ sessionId: 'a4' }, () => Promise.resolve(s2)))
const gd = await getDef.execute({}, { agent: agentD })
if (gd.goal.phase !== 'budget_limited') throw new Error('expected budget_limited a4: ' + gd.goal.phase)
let rs = false
try { await updDef.execute({ goal_id: gd.goal.id, revision: gd.goal.revision, action: 'resume' }, { agent: agentD }) } catch (e) { rs = true }
if (!rs) throw new Error('resume with exhausted budget should throw')

// ---- bridge goal-view / goal-action ----
const v1 = await call({ action: 'goal-view', args: { sessionId: 'a1' } })
if (!v1.body.ok || !v1.body.goal) throw new Error('goal-view fail: ' + JSON.stringify(v1.body))
if (v1.body.goal.tokenBudget !== 5000 || v1.body.goal.phase !== 'active') throw new Error('goal-view mismatch: ' + JSON.stringify(v1.body.goal))

const pa = await call({ action: 'goal-action', args: { sessionId: 'a1', action: 'pause' } })
if (!pa.body.ok || pa.body.goal.phase !== 'paused') throw new Error('pause fail: ' + JSON.stringify(pa.body))

const cl = await call({ action: 'goal-action', args: { sessionId: 'a1', action: 'clear' } })
if (!cl.body.ok || cl.body.goal !== null) throw new Error('clear fail: ' + JSON.stringify(cl.body))

const v2 = await call({ action: 'goal-view', args: { sessionId: 'a1' } })
if (v2.body.goal !== null) throw new Error('after clear goal-view should be null')
// 无目标时 goal-action 报错
const na = await call({ action: 'goal-action', args: { sessionId: 'a1', action: 'pause' } })
if (na.body.ok) throw new Error('goal-action on cleared goal should fail')

// 编辑 objective + budget（a4 预算耗尽时 edit 提高预算 → status 解除）
const ev = await call({ action: 'goal-action', args: { sessionId: 'a4', action: 'edit', objective: '改过的目标', token_budget: 100 } })
if (!ev.body.ok) throw new Error('edit fail: ' + JSON.stringify(ev.body))
if (ev.body.goal.objective !== '改过的目标') throw new Error('objective not edited')
if (ev.body.goal.phase !== 'paused') throw new Error('after budget raise a4 should be paused: ' + JSON.stringify(ev.body.goal))
const rv = await call({ action: 'goal-action', args: { sessionId: 'a4', action: 'resume' } })
if (!rv.body.ok || rv.body.goal.phase !== 'active') throw new Error('resume via bridge fail: ' + JSON.stringify(rv.body))

// 未知操作报错
const unk = await call({ action: 'goal-action', args: { sessionId: 'a4', action: 'nope' } })
if (unk.body.ok) throw new Error('unknown goal action should fail')

await rm(WORK, { recursive: true, force: true })
console.log('GOAL OK: scoped tools, create/get/update(token budget), usage accounting, budget_limited+pause, authority, bridge view/action')
