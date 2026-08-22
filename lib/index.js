/**
 * dsh-tree — 宿主半区：资源管理器的文件能力供给器。
 *
 * 通过 `webServer` 注册一个同源 HTTP 路由 `/api/dsh-tree`（POST JSON），
 * 为浏览器半区提供对文件系统的只具名操作：列目录、系统打开、移到废纸篓、
 * 移动/重命名、新建、上传。永久插件（profile bundle）不经过动态 runner，
 * 因此不依赖 dynamic 半区的 `harness.handle`/`host.call`，而是走
 * 宿主 HTTP 路由 + 浏览器 `fetch` 的规范桥梁。
 *
 * 跨平台：move/create/upload 直接用 `node:fs/promises`（mac/linux/win 通用），
 * 仅 open/trash 这类"唤起系统"的动作按 `process.platform` 分支选命令。
 */

import { rename, mkdir, writeFile } from 'node:fs/promises'

/** 稳定插件名（与 cordis.patch.yml 的 insert id 一致）。 */
export const name = 'ui-dsh-tree'

/** 注入的宿主服务。 */
export const inject = ['webServer', 'fs', 'subprocess', 'sandboxPolicy', 'sessions', 'timer', 'agents', 'goals', 'tools']

/** 当前运行平台：'mac' | 'linux' | 'win'（其余回退 mac 逻辑）。 */
const PLATFORM = process.platform === 'win32' ? 'win'
  : process.platform === 'darwin' ? 'mac'
    : process.platform === 'linux' ? 'linux' : 'mac'

/**
 * 读取一次请求体为 JSON 对象（损坏或不存在的 body 返回空对象）。
 * @param req - node:http IncomingMessage。
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) { resolve({}); return }
      try { resolve(JSON.parse(text)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

/** 写一个 JSON 响应。 */
function writeJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * 应用宿主半区：注册文件操作路由。
 * @param ctx - cordis 宿主上下文。
 */
export function apply(ctx) {
  const fs = ctx.fs
  const subprocess = ctx.subprocess
  const sessions = ctx.sessions
  const root = (ctx.sandboxPolicy && ctx.sandboxPolicy.workspaceRoot) || '/'

  // ------------------------------------------------------------------
  // 速度徽标：包 llm/stream 统计 token 吞吐（等待/流式/done 三态）
  // ------------------------------------------------------------------
  const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
  function estimateChars(text) {
    let cjk = 0
    let rest = 0
    for (const ch of text) { if (CJK.test(ch)) cjk++; else rest++ }
    return cjk + rest / 4
  }

  /** 会话级流状态：phase / token / tps / ttft。 */
  const streams = new Map()

  function extractKey(options) {
    try {
      if (!options) return null
      if (typeof options.sessionId === 'string') return options.sessionId
      if (options.session && typeof options.session.id === 'string') return options.session.id
      if (options.agent) {
        const a = options.agent
        if (typeof a.sessionId === 'string') return a.sessionId
        if (typeof a.id === 'string') return a.id
        if (a.session && typeof a.session.id === 'string') return a.session.id
      }
      if (options.meta && typeof options.meta.sessionId === 'string') return options.meta.sessionId
    } catch (err) { /* ignore */ }
    return null
  }

  function extractChunk(chunk) {
    let text = ''
    let realTokens = null
    try {
      if (!chunk) return { text, realTokens }
      if (typeof chunk.text === 'string') text += chunk.text
      if (typeof chunk.content === 'string') text += chunk.content
      if (Array.isArray(chunk.content)) {
        for (const part of chunk.content) if (part && typeof part.text === 'string') text += part.text
      }
      if (chunk.delta) {
        const d = chunk.delta
        if (typeof d.text === 'string') text += d.text
        if (typeof d.content === 'string') text += d.content
        if (d.usage) {
          const ot = d.usage.outputTokens != null ? d.usage.outputTokens
            : (d.usage.output_tokens != null ? d.usage.output_tokens
              : (d.usage.completion_tokens != null ? d.usage.completion_tokens : d.usage.completionTokens))
          if (typeof ot === 'number') realTokens = ot
        }
      }
      if (chunk.usage) {
        const u = chunk.usage
        const ot = u.outputTokens != null ? u.outputTokens
          : (u.output_tokens != null ? u.output_tokens
            : (u.completion_tokens != null ? u.completion_tokens : u.completionTokens))
        if (typeof ot === 'number') realTokens = ot
      }
      if (Array.isArray(chunk.choices)) {
        for (const c of chunk.choices) {
          const d = c && c.delta
          if (d && typeof d.content === 'string') text += d.content
          if (d && d.usage) {
            const ot = d.usage.outputTokens != null ? d.usage.outputTokens : d.usage.output_tokens
            if (typeof ot === 'number') realTokens = ot
          }
        }
      }
    } catch (err) { /* ignore */ }
    return { text, realTokens }
  }

  /** 从 chunk 提取一次调用的完整 usage 总 token（input+output+cache）。 */
  function extractUsageTotal(chunk) {
    let u = null
    try {
      if (!chunk) return 0
      if (chunk.type === 'usage' && chunk.usage) u = chunk.usage
      else if (chunk.usage) u = chunk.usage
      else if (chunk.delta && chunk.delta.usage) u = chunk.delta.usage
      else if (Array.isArray(chunk.choices)) {
        for (const c of chunk.choices) {
          if (c && c.delta && c.delta.usage) { u = c.delta.usage; break }
        }
      }
    } catch (err) { return 0 }
    if (!u) return 0
    const num = (v, keys) => {
      for (const k of keys) if (typeof v[k] === 'number') return v[k]
      return 0
    }
    const input = num(u, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'])
    const output = num(u, ['outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens'])
    const cacheRead = num(u, ['cacheReadTokens', 'cache_read_tokens', 'cacheHitTokens', 'cache_hit_tokens'])
    const cacheWrite = num(u, ['cacheWriteTokens', 'cache_write_tokens', 'cacheCreationTokens', 'cache_creation_tokens'])
    return input + output + cacheRead + cacheWrite
  }

  ctx.on('llm/stream', (options, next) => {
    const key = extractKey(options) || '_'
    const now = Date.now()
    streams.set(key, { phase: 'waiting', startedAt: now, firstChunkAt: null, charTokens: 0, realTokens: 0, hasReal: false, usageTotal: 0, lastSeen: now })
    const innerP = Promise.resolve(next())
    return (async function* () {
      try {
        const inner = await innerP
        for await (const chunk of inner) {
          const st = streams.get(key)
          if (st) {
            const parsed = extractChunk(chunk)
            if (st.firstChunkAt === null) { st.firstChunkAt = Date.now(); st.phase = 'streaming' }
            if (parsed.text) st.charTokens += estimateChars(parsed.text)
            if (parsed.realTokens != null) { st.realTokens = parsed.realTokens; st.hasReal = true }
            const usageTotal = extractUsageTotal(chunk)
            if (usageTotal > 0) st.usageTotal = usageTotal
            st.lastSeen = Date.now()
          }
          yield chunk
        }
      } finally {
        const st = streams.get(key)
        if (st) {
          st.phase = 'done'
          st.lastSeen = Date.now()
          // goal 记账：优先真实 usage 总量，缺失时回退输出 token 估算
          const delta = st.usageTotal > 0 ? st.usageTotal
            : (st.hasReal ? st.realTokens : Math.round(st.charTokens))
          if (delta > 0) accumulateGoalUsage(key, delta)
        }
      }
    })()
  })

  const stopReap = ctx.timer.interval(() => {
    const now = Date.now()
    for (const [k, st] of streams) {
      if (st.phase === 'done' && now - st.lastSeen > 4000) streams.delete(k)
    }
  }, 1000)
  ctx.effect(stopReap, 'dsh-tree: speed stream reap')

  /** 返回当前会话的速度状态（无记录时回退到最近活跃流）。 */
  function speedStatus(sid) {
    let st = streams.get(sid)
    if (!st) {
      let latest = null
      for (const s of streams.values()) if (!latest || s.lastSeen > latest.lastSeen) latest = s
      st = latest
    }
    if (!st) return { phase: 'idle' }
    st.lastSeen = Date.now()
    const now = Date.now()
    const tokens = st.hasReal ? st.realTokens : Math.round(st.charTokens)
    let tps = 0
    if (st.phase === 'streaming' && st.firstChunkAt) {
      const elapsed = (now - st.firstChunkAt) / 1000
      if (elapsed > 0.5) tps = tokens / elapsed
    }
    return { phase: st.phase, tokens, tps, ttft: st.firstChunkAt ? st.firstChunkAt - st.startedAt : null }
  }

  // ------------------------------------------------------------------
  // Goal 覆盖层：token 预算替换原生轮数预算。
  // 复用 ctx.goals（目标/阶段/持久化/自动续轮由原生 driver 驱动），
  // dsh-tree 只加 token 记账与预算门禁：预算耗尽 → budget_limited + 暂停。
  // ------------------------------------------------------------------
  const GOAL_BIG_ROUNDS = 2147483647 // 巨大轮数上限：轮数永不绑定，由 token 预算接管
  const TERMINAL_GOAL = { complete: true, blocked: true, budget_limited: true }

  /** 每会话 token 层：{ tokenBudget, tokensUsed, status, createdAt }。 */
  const goalState = new Map()

  function toolError(message, code) {
    const err = new Error(message)
    err.code = code || 'GOAL_TOOL_ERROR'
    return err
  }

  function normalizeBudget(raw) {
    if (raw === undefined || raw === null || raw === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(n)) {
      throw toolError('token_budget 必须是正整数或 null', 'GOAL_INVALID_TOKEN_BUDGET')
    }
    return n
  }

  function resolveAgent(exec) {
    const agent = exec && exec.agent
    if (!agent) throw toolError('goal 工具需要调用 agent', 'GOAL_TOOL_AGENT_REQUIRED')
    if (ctx.agents.get(agent.id) !== agent) throw toolError('goal 工具需要精确的存活调用 agent', 'GOAL_TOOL_DRIVER_REQUIRED')
    return agent
  }

  function isRootAgent(agent) {
    try { return ctx.agents.roots().includes(agent) } catch (err) { return false }
  }

  /** 当前 turn 是否含直接人类输入（近似原生 requireDirectHuman）。 */
  function hasDirectHuman(agent) {
    if (!isRootAgent(agent)) return false
    const events = (agent.session && agent.session.events) || []
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (!e) continue
      if (e.type === 'turn/end') return false
      if (e.type === 'user/message') {
        const src = e.data && e.data.source
        if (src && src.kind === 'user') return true
        if (src && src.kind === 'goal') return false
      }
    }
    return false
  }

  /** 当前 turn 是否属于某 goal 续轮（近似原生 isMatchingGoalRound）。 */
  function hasGoalRound(agent) {
    const events = (agent.session && agent.session.events) || []
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (!e) continue
      if (e.type === 'turn/end') return false
      if (e.type === 'user/message') {
        const src = e.data && e.data.source
        if (src && src.kind === 'goal') return true
      }
    }
    return false
  }

  /** 合并原生 goal 视图 + dsh-tree token 层。 */
  function goalView(agent, sid) {
    const native = ctx.goals.get(agent)
    if (!native) return null
    const gs = goalState.get(sid)
    let phase = native.phase
    if (gs && gs.status === 'budget_limited' && native.phase !== 'complete') phase = 'budget_limited'
    return {
      id: native.id,
      revision: native.revision,
      objective: native.objective,
      phase,
      status: gs ? gs.status : 'active',
      tokenBudget: gs ? gs.tokenBudget : null,
      tokensUsed: gs ? gs.tokensUsed : 0,
      timeUsedSeconds: gs ? Math.round((Date.now() - gs.createdAt) / 1000) : 0,
      blockedReason: native.blockedReason,
      activation: native.activation,
    }
  }

  function goalValue(view) {
    if (!view) return { goal: null }
    const goal = {
      id: view.id,
      revision: view.revision,
      objective: view.objective,
      phase: view.phase,
      tokenBudget: view.tokenBudget,
      tokensUsed: view.tokensUsed,
      timeUsedSeconds: view.timeUsedSeconds,
    }
    if (view.blockedReason) goal.blockedReason = view.blockedReason
    return { goal, activation: view.activation }
  }

  /** llm/stream 记账入口：每流结束后把 usage 总量累加到该会话 goal 账户。 */
  function accumulateGoalUsage(sid, delta) {
    const gs = goalState.get(sid)
    if (!gs || !(delta > 0)) return
    gs.tokensUsed += Math.round(delta)
    checkGoalBudget(sid, gs)
  }

  /** 预算耗尽 → budget_limited + 暂停原生 goal（停掉自动续轮）。 */
  function checkGoalBudget(sid, gs) {
    if (gs.tokenBudget === null || gs.tokensUsed < gs.tokenBudget) return
    if (TERMINAL_GOAL[gs.status]) return
    gs.status = 'budget_limited'
    gs.limitedAt = Date.now()
    try {
      const agent = ctx.agents.get(sid)
      if (agent) {
        const g = ctx.goals.get(agent)
        if (g && g.phase === 'active') ctx.goals.pause(agent, { id: g.id, revision: g.revision })
      }
    } catch (err) { /* 忽略并发暂停失败 */ }
  }

  // ---- 替换工具：create_goal / get_goal / update_goal（token 语义）----
  const GOAL_OUTPUT_SCHEMA = {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { goal: { type: 'null', required: true } } },
      {
        type: 'object', additionalProperties: false,
        properties: {
          goal: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              id: { type: 'string', required: true },
              revision: { type: 'integer', required: true },
              objective: { type: 'string', required: true },
              phase: { type: 'string', required: true, enum: ['active', 'paused', 'blocked', 'complete', 'budget_limited'] },
              tokenBudget: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
              tokensUsed: { type: 'integer', required: true },
              timeUsedSeconds: { type: 'integer', required: true },
              blockedReason: {
                type: 'object', additionalProperties: false,
                properties: { code: { type: 'string', required: true }, message: { type: 'string', required: true } },
              },
            },
          },
          activation: { type: 'string', required: true, enum: ['armed', 'disarmed'] },
        },
      },
    ],
  }

  function renderGoalValue(args, value) {
    return [{ type: 'text', text: JSON.stringify(value) }]
  }

  function createGoalTool() {
    return {
      name: 'create_goal',
      description: '为当前会话创建一个带 token 预算的目标，并返回目标状态。创建后会持续自动续轮，直到目标完成、暂停或 token 预算耗尽。',
      parameters: {
        type: 'object',
        properties: {
          objective: { type: 'string', description: '从直接人类请求中推断出的具体完成目标。' },
          token_budget: {
            oneOf: [{ type: 'number' }, { type: 'null' }],
            description: '整个目标的 token 预算（输入+输出+缓存 token）。省略或传 null 表示不设上限。',
          },
        },
        required: ['objective'],
      },
      output: { schema: GOAL_OUTPUT_SCHEMA, render: renderGoalValue },
      async execute(args, exec) {
        const agent = resolveAgent(exec)
        const sid = agent.id
        const objective = String((args && args.objective) || '').trim()
        if (!objective) throw toolError('create_goal 需要非空 objective', 'GOAL_INVALID_OBJECTIVE')
        const budget = normalizeBudget(args && args.token_budget)
        if (!hasDirectHuman(agent)) throw toolError('create_goal 需要顶层 agent 的直接人类轮', 'GOAL_TOOL_AUTHORITY_REQUIRED')
        const existing = ctx.goals.get(agent)
        if (existing && existing.phase !== 'complete') throw toolError('该会话已有一个进行中的目标', 'GOAL_ALREADY_EXISTS')
        try {
          ctx.goals.create(agent, { objective, maxGoalRounds: GOAL_BIG_ROUNDS })
        } catch (err) {
          throw toolError(String((err && err.message) || err), (err && err.code) || 'GOAL_CREATE_FAILED')
        }
        goalState.set(sid, { tokenBudget: budget, tokensUsed: 0, status: 'active', createdAt: Date.now() })
        return goalValue(goalView(agent, sid))
      },
    }
  }

  function getGoalTool() {
    return {
      name: 'get_goal',
      description: '读取当前目标状态，含 token 预算、已用 token、耗时与阶段。无目标时返回 { goal: null }。',
      parameters: { type: 'object', properties: {}, required: [] },
      output: { schema: GOAL_OUTPUT_SCHEMA, render: renderGoalValue },
      async execute(args, exec) {
        const agent = resolveAgent(exec)
        return goalValue(goalView(agent, agent.id))
      },
    }
  }

  function updateGoalTool() {
    return {
      name: 'update_goal',
      description: '更新当前目标：编辑目标或 token 预算、暂停、恢复、完成或标记受阻。',
      parameters: {
        type: 'object',
        properties: {
          goal_id: { type: 'string', description: '来自 get_goal 的精确目标 id。' },
          revision: { type: 'number', description: '来自 get_goal 的精确 revision。' },
          action: {
            type: 'string',
            enum: ['edit', 'pause', 'resume', 'complete', 'blocked'],
            description: '要执行的操作。',
          },
          objective: { type: 'string', description: '新目标文本（仅 edit）。' },
          token_budget: {
            oneOf: [{ type: 'number' }, { type: 'null' }],
            description: '新 token 预算（仅 edit）。省略保持不变；传 null 移除上限。',
          },
          blocked_reason: { type: 'string', description: 'blocked 操作的原因。' },
        },
        required: ['goal_id', 'revision', 'action'],
      },
      output: { schema: GOAL_OUTPUT_SCHEMA, render: renderGoalValue },
      async execute(args, exec) {
        const agent = resolveAgent(exec)
        const sid = agent.id
        const goalId = String((args && args.goal_id) || '')
        const revision = Number(args && args.revision)
        const action = String((args && args.action) || '')
        if (!goalId || !Number.isFinite(revision)) throw toolError('update_goal 需要 goal_id 与 revision', 'GOAL_INVALID_REF')
        const ref = { id: goalId, revision }
        const current = ctx.goals.get(agent)
        if (!current || current.id !== goalId) throw toolError('没有匹配的目标', 'GOAL_NOT_FOUND')
        const gs = goalState.get(sid) || { tokenBudget: null, tokensUsed: 0, status: 'active', createdAt: Date.now() }
        switch (action) {
          case 'edit': {
            if (args && args.objective !== undefined) {
              const objective = String(args.objective).trim()
              if (!objective) throw toolError('objective 不能为空', 'GOAL_INVALID_OBJECTIVE')
              ctx.goals.edit(agent, ref, { objective })
            }
            if (args && args.token_budget !== undefined) {
              gs.tokenBudget = normalizeBudget(args.token_budget)
              if (gs.status === 'budget_limited' && (gs.tokenBudget === null || gs.tokensUsed < gs.tokenBudget)) gs.status = 'active'
            }
            goalState.set(sid, gs)
            return goalValue(goalView(agent, sid))
          }
          case 'pause': {
            ctx.goals.pause(agent, ref)
            gs.status = 'paused'
            goalState.set(sid, gs)
            return goalValue(goalView(agent, sid))
          }
          case 'resume': {
            if (gs.tokenBudget !== null && gs.tokensUsed >= gs.tokenBudget) {
              throw toolError('token 预算已耗尽，请先通过 edit 提高 token_budget 再恢复', 'GOAL_BUDGET_EXHAUSTED')
            }
            ctx.goals.resume(agent, ref)
            if (gs.status === 'budget_limited') gs.status = 'active'
            goalState.set(sid, gs)
            return goalValue(goalView(agent, sid))
          }
          case 'complete': {
            if (!hasDirectHuman(agent) && !hasGoalRound(agent)) throw toolError('complete 需要直接人类轮或当前目标轮', 'GOAL_TOOL_AUTHORITY_REQUIRED')
            ctx.goals.complete(agent, ref)
            gs.status = 'complete'
            goalState.set(sid, gs)
            return goalValue(goalView(agent, sid))
          }
          case 'blocked': {
            if (!hasDirectHuman(agent) && !hasGoalRound(agent)) throw toolError('blocked 需要直接人类轮或当前目标轮', 'GOAL_TOOL_AUTHORITY_REQUIRED')
            const message = String((args && args.blocked_reason) || '').trim()
            ctx.goals.block(agent, ref, { code: 'model-reported', message: message || 'no reason given' })
            gs.status = 'blocked'
            goalState.set(sid, gs)
            return goalValue(goalView(agent, sid))
          }
          default:
            throw toolError(`未知 update_goal 操作: ${action}`, 'GOAL_INVALID_ACTION')
        }
      },
    }
  }

  /** 为单个 agent 安装替换工具（仅 root；遮蔽全局同名工具）。 */
  function installGoalTools(agent) {
    if (installedAgents.has(agent)) return
    installedAgents.add(agent)
    agent.ctx.effect(() => {
      const disposes = []
      try {
        disposes.push(agent.ctx.tools.register(createGoalTool()))
        disposes.push(agent.ctx.tools.register(getGoalTool()))
        disposes.push(agent.ctx.tools.register(updateGoalTool()))
      } catch (err) {
        console.error('[dsh-tree] goal 工具注册失败:', (err && err.message) || err)
      }
      return () => { for (const d of disposes) { try { d() } catch (err) { /* ignore */ } } }
    }, 'dsh-tree: goal tools')
  }

  const installedAgents = new Set()
  ctx.effect(() => {
    // 已有 root agents 也要安装（agent/created 只对之后创建的生效）
    try { for (const agent of ctx.agents.roots()) installGoalTools(agent) } catch (err) { /* ignore */ }
    const stopCreated = ctx.on('agent/created', ({ agent }) => {
      try {
        if (ctx.agents.roots().includes(agent)) installGoalTools(agent)
      } catch (err) { /* ignore */ }
    })
    return () => { stopCreated() }
  }, 'dsh-tree: goal tool lifecycle')

  /** 运行一条命令并返回退出码或错误。 */
  async function runCmd(argv) {
    try {
      const proc = subprocess.spawn({
        argv,
        cwd: '/',
        stdio: { stdin: 'ignore', stdout: 'ignore', stderr: { maxBytes: 4096 } },
        graceMs: 6000,
      })
      const outcome = await proc.done
      return { code: outcome.exitCode }
    } catch (err) {
      return { error: String((err && err.message) || err) }
    }
  }

  /** 拼接目录与子项（统一正斜杠，兼容各平台）。 */
  function joinPath(dir, name) {
    return String(dir || '').replace(/[\\/]+$/, '') + '/' + name
  }

  /** 系统打开一个路径（按平台选命令）。 */
  async function openPath(path) {
    const p = String(path || '')
    if (!p) return { code: -1, error: '缺少路径' }
    if (PLATFORM === 'win') {
      // explorer /select 打开所在位置；单文件用 start 调默认程序
      return runCmd(['cmd', '/c', 'start', '', p])
    }
    if (PLATFORM === 'linux') {
      return runCmd(['xdg-open', p])
    }
    return runCmd(['/usr/bin/open', p])
  }

  /** 移到废纸篓（按平台选实现）。 */
  async function trashPath(path) {
    const p = String(path || '')
    if (!p) return { ok: false, error: '缺少路径' }
    if (PLATFORM === 'win') {
      // PowerShell Shell.Application 的 NameSpace(10) = 回收站
      const esc = String(p).replace(/'/g, "''")
      const script = `$sh = New-Object -ComObject Shell.Application; $sh.NameSpace(10).MoveHere('${esc}'); Start-Sleep -Milliseconds 300`
      const res = await runCmd(['powershell', '-NoProfile', '-Command', script])
      return res.code === 0
        ? { ok: true }
        : { ok: false, error: res.error || '移动失败', hint: '请确认 PowerShell 可用（Windows 10+ 自带）' }
    }
    if (PLATFORM === 'linux') {
      // 优先 gio trash（GNOME 自带），回退 trash-cli 的 trash 命令
      const res = await runCmd(['gio', 'trash', p])
      if (res.code === 0) return { ok: true }
      const res2 = await runCmd(['trash', p])
      if (res2.code === 0) return { ok: true }
      return { ok: false, error: (res.error || res2.error) || '移动失败', hint: '请安装 gio（glib2）或 trash-cli（如: sudo apt install trash-cli）' }
    }
    // mac: Finder osascript
    const esc = String(p).replace(/"/g, '\\"')
    const script = `tell application "Finder" to delete POSIX file "${esc}"`
    const res = await runCmd(['/usr/bin/osascript', '-e', script])
    return res.code === 0
      ? { ok: true }
      : { ok: false, error: res.error || '移动失败', hint: '如需移到废纸篓，请在 系统设置→隐私与安全性→自动化 中允许 DSH 控制 Finder' }
  }

  /** 统一路由 dispatch：每个 action 返回可 JSON 序列化的结果。 */
  async function handleAction(body) {
    const action = body && body.action
    const args = (body && body.args) || {}
    switch (action) {
      case 'root': {
        return { ok: true, root }
      }
      case 'sessionCwd': {
        const id = args.sessionId
        const session = id ? sessions.get(id) : undefined
        const cwd = session && session.header && session.header.cwd
        return cwd ? { ok: true, cwd } : { ok: false }
      }
      case 'list': {
        const path = String(args.path || root)
        const target = await fs.resolve(path, { cwd: root })
        let entries
        try {
          entries = await fs.listDir(target)
        } catch (err) {
          return { ok: false, error: `无法读取目录: ${String((err && err.message) || err)}` }
        }
        const out = entries.map((entry) => {
          const item = {
            name: entry.name,
            type: entry.type,
            path: entry.target && entry.target.displayPath ? entry.target.displayPath : `${path}/${entry.name}`,
          }
          if (typeof entry.size === 'number' && entry.size >= 0) item.size = entry.size
          return item
        })
        return { ok: true, root, path: target.displayPath, entries: out }
      }
      case 'open': {
        const res = await openPath(args.path)
        return res.code === 0 ? { ok: true } : { ok: false, error: res.error || '打开失败' }
      }
      case 'trash': {
        return trashPath(args.path)
      }
      case 'move': {
        const from = String((args && args.from) || '')
        const to = String((args && args.to) || '')
        if (!from || !to) return { ok: false, error: '缺少路径' }
        try {
          await rename(from, to)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: `移动/重命名失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'create': {
        const dir = String((args && args.dir) || '')
        const newName = String((args && args.name) || '')
        const isDir = Boolean(args && args.isDir)
        if (!dir || !newName || newName === '.' || newName === '..' || newName.includes('/') || newName.includes('\\') || newName.includes('\0')) {
          return { ok: false, error: '无效文件名' }
        }
        const target = joinPath(dir, newName)
        try {
          if (isDir) {
            await mkdir(target, { recursive: true })
          } else {
            await writeFile(target, '')
          }
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `${isDir ? '新建文件夹' : '新建文件'}失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'upload': {
        const dir = String((args && args.dir) || '')
        const fileName = String((args && args.name) || '')
        const data = String((args && args.data) || '')
        if (!dir || !fileName) return { ok: false, error: '缺少参数' }
        const target = joinPath(dir, fileName)
        try {
          await writeFile(target, Buffer.from(data.replace(/\s+/g, ''), 'base64'))
          return { ok: true, path: target }
        } catch (err) {
          return { ok: false, error: `写入失败: ${String((err && err.message) || err)}` }
        }
      }
      case 'speed-status': {
        const sid = args && args.sessionId ? String(args.sessionId) : ''
        return { ok: true, ...speedStatus(sid) }
      }
      case 'goal-view': {
        const sid = args && args.sessionId ? String(args.sessionId) : ''
        if (!sid) return { ok: false, error: '缺少 sessionId' }
        const agent = ctx.agents.get(sid)
        if (!agent) return { ok: false, error: '无此会话' }
        return { ok: true, goal: goalView(agent, sid) }
      }
      case 'goal-action': {
        const sid = args && args.sessionId ? String(args.sessionId) : ''
        const action = args && args.action ? String(args.action) : ''
        if (!sid || !action) return { ok: false, error: '缺少 sessionId/action' }
        const agent = ctx.agents.get(sid)
        if (!agent) return { ok: false, error: '无此会话' }
        const view = ctx.goals.get(agent)
        if (!view) return { ok: false, error: '无目标' }
        const ref = { id: view.id, revision: view.revision }
        try {
          switch (action) {
            case 'pause': ctx.goals.pause(agent, ref); break
            case 'resume': {
              const gs = goalState.get(sid)
              if (gs && gs.tokenBudget !== null && gs.tokensUsed >= gs.tokenBudget) {
                return { ok: false, error: 'token 预算已耗尽，请先 edit 提高 token_budget 再恢复' }
              }
              ctx.goals.resume(agent, ref)
              if (gs && gs.status === 'budget_limited') gs.status = 'active'
              break
            }
            case 'complete': ctx.goals.complete(agent, ref); break
            case 'blocked': ctx.goals.block(agent, ref, { code: 'user', message: '用户标记为受阻' }); break
            case 'edit': {
              if (args.objective !== undefined) ctx.goals.edit(agent, ref, { objective: String(args.objective) })
              if (args.token_budget !== undefined) {
                const gs = goalState.get(sid) || { tokenBudget: null, tokensUsed: 0, status: 'active', createdAt: Date.now() }
                gs.tokenBudget = normalizeBudget(args.token_budget)
                if (gs.status === 'budget_limited' && (gs.tokenBudget === null || gs.tokensUsed < gs.tokenBudget)) gs.status = 'active'
                goalState.set(sid, gs)
              }
              break
            }
            case 'clear': {
              ctx.goals.clear(agent, ref)
              goalState.delete(sid)
              break
            }
            default:
              return { ok: false, error: `未知 goal 操作: ${action}` }
          }
          return { ok: true, goal: goalView(agent, sid) }
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      }
      default:
        return { ok: false, error: `unknown action: ${String(action)}` }
    }
  }

  /** HTTP 处理器：解析 body → dispatch → JSON 响应。 */
  async function handler(req, res) {
    try {
      const body = await readBody(req)
      const result = await handleAction(body)
      writeJson(res, 200, result)
    } catch (err) {
      writeJson(res, 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: '/api/dsh-tree', handler }),
    'dsh-tree: file http route',
  )
}
