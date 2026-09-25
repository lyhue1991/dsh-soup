/** Session-scoped LLM stream throughput tracker used by the input speed badge. */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const RATE_WINDOW_MS = 2000
const RATE_MIN_SPAN_MS = 500
const STALL_MS = 2000
const MIN_REAL_TPS = 3
const SPAN_GRACE_MS = 500

function estimateChars(text) {
  let cjk = 0
  let rest = 0
  for (const char of text) { if (CJK.test(char)) cjk++; else rest++ }
  return cjk + rest / 4
}

function sessionKey(options) {
  try {
    if (!options) return null
    if (typeof options.sessionId === 'string') return options.sessionId
    if (typeof options.session?.id === 'string') return options.session.id
    const agent = options.agent
    if (agent) {
      if (typeof agent.sessionId === 'string') return agent.sessionId
      if (typeof agent.id === 'string') return agent.id
      if (typeof agent.session?.id === 'string') return agent.session.id
    }
    if (typeof options.meta?.sessionId === 'string') return options.meta.sessionId
  } catch { /* malformed stream options do not affect the stream */ }
  return null
}

function outputTokens(usage) {
  if (!usage) return null
  const value = usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens
  return typeof value === 'number' ? value : null
}

function extractChunk(chunk) {
  let text = ''
  let realTokens = null
  const appendText = (value) => {
    if (typeof value === 'string') text += value
    else if (Array.isArray(value)) {
      for (const part of value) {
        if (typeof part === 'string') text += part
        else if (part && typeof part.text === 'string') text += part.text
      }
    }
  }
  try {
    if (!chunk) return { text, realTokens }
    appendText(chunk.text)
    appendText(chunk.content)
    // Reasoning streams use different names across providers/adapters. They
    // are still generated output and must keep the throughput window alive.
    appendText(chunk.reasoning_content)
    appendText(chunk.reasoningContent)
    appendText(chunk.reasoning)
    appendText(chunk.thinking)
    if (chunk.delta) {
      appendText(chunk.delta.text)
      appendText(chunk.delta.content)
      appendText(chunk.delta.reasoning_content)
      appendText(chunk.delta.reasoningContent)
      appendText(chunk.delta.reasoning)
      appendText(chunk.delta.thinking)
      realTokens = outputTokens(chunk.delta.usage) ?? realTokens
    }
    realTokens = outputTokens(chunk.usage) ?? realTokens
    if (Array.isArray(chunk.choices)) {
      for (const choice of chunk.choices) {
        appendText(choice?.delta?.text)
        appendText(choice?.delta?.content)
        appendText(choice?.delta?.reasoning_content)
        appendText(choice?.delta?.reasoningContent)
        appendText(choice?.delta?.reasoning)
        appendText(choice?.delta?.thinking)
        realTokens = outputTokens(choice?.delta?.usage) ?? realTokens
      }
    }
  } catch { /* best-effort metrics must never interfere with output */ }
  return { text, realTokens }
}

export function createSpeedTracker() {
  // sessionId -> concurrent stream states. Background tasks (subagents, title
  // generation) open LLM streams under the same sessionId as the main reply,
  // so a session may genuinely have several live streams at once; a single
  // slot per session let a short background stream clobber the main reply's
  // state (badge vanished while the main answer was still streaming).
  const streams = new Map()
  const MAX_STATES_PER_KEY = 4

  function wrap(options, next) {
    const key = sessionKey(options) || '_'
    const now = Date.now()
    const state = { phase: 'waiting', startedAt: now, firstChunkAt: null, charTokens: 0, realTokens: 0, hasReal: false, lastChunkAt: null, lastContentAt: null, samples: [], lastSeen: now }
    const states = streams.get(key) || []
    states.push(state)
    while (states.length > MAX_STATES_PER_KEY) states.shift()
    streams.set(key, states)
    const innerPromise = Promise.resolve(next())
    return (async function* () {
      try {
        const inner = await innerPromise
        for await (const chunk of inner) {
          // Each stream state is independent: a concurrent (or later) stream
          // for the same session never blocks or corrupts this one's bookkeeping.
          const parsed = extractChunk(chunk)
          const time = Date.now()
          if (state.firstChunkAt === null) { state.firstChunkAt = time; state.phase = 'streaming' }
          if (parsed.text) state.charTokens += estimateChars(parsed.text)
          if (parsed.realTokens != null) { state.realTokens = parsed.realTokens; state.hasReal = true }
          state.lastChunkAt = time
          if (parsed.text || parsed.realTokens != null) state.lastContentAt = time
          state.samples.push([time, state.hasReal ? state.realTokens : state.charTokens])
          if (state.samples.length > 128) state.samples.splice(0, state.samples.length - 128)
          state.lastSeen = time
          yield chunk
        }
      } finally {
        state.phase = 'done'
        state.lastSeen = Date.now()
      }
    })()
  }

  function status(sessionId) {
    let pool = streams.get(sessionId) || []
    if (pool.length === 0 && !sessionId) {
      // No-id fallback (badge could not resolve any session id): pick the
      // session with the freshest activity. A real sessionId must never see
      // another session's traffic, so an unknown id simply stays idle.
      let best = null
      for (const states of streams.values()) {
        const latest = states[states.length - 1]
        if (latest && (!best || latest.lastSeen > best.lastSeen)) best = latest
      }
      pool = best ? [best] : []
    }
    // Prefer the most recently active still-running stream (the main reply),
    // falling back to the most recent settled one only when nothing is live.
    const live = pool.filter((s) => s.phase !== 'done')
    const sorted = (live.length ? live : pool).slice().sort((a, b) => b.lastSeen - a.lastSeen)
    const state = sorted[0]
    if (!state) return { phase: 'idle' }
    const now = Date.now()
    const tokens = state.hasReal ? state.realTokens : Math.round(state.charTokens)
    const ttft = state.firstChunkAt ? state.firstChunkAt - state.startedAt : null
    if (state.phase !== 'streaming' || !state.firstChunkAt) return { phase: state.phase, tokens, tps: 0, ttft }
    const contentAt = state.lastContentAt || state.firstChunkAt
    const sinceContent = now - contentAt
    if (sinceContent > STALL_MS) return { phase: 'waiting', tokens, tps: 0, ttft }
    const cutoff = now - RATE_WINDOW_MS
    let base = null
    let first = null
    for (const sample of state.samples) { if (first === null) first = sample; if (sample[0] < cutoff) base = sample }
    base ||= first
    let tps = 0
    if (base && now - base[0] >= RATE_MIN_SPAN_MS) {
      const spanEnd = Math.min(now, contentAt + SPAN_GRACE_MS)
      if (spanEnd - base[0] >= RATE_MIN_SPAN_MS) tps = Math.max(0, (tokens - base[1]) / ((spanEnd - base[0]) / 1000))
    }
    if (sinceContent >= RATE_MIN_SPAN_MS && tps < MIN_REAL_TPS) return { phase: 'waiting', tokens, tps: 0, ttft }
    return { phase: 'streaming', tokens, tps, ttft }
  }

  function reap(now = Date.now()) {
    for (const [key, states] of streams) {
      const kept = states.filter((state) => state.phase !== 'done' || now - state.lastSeen <= 4000)
      if (kept.length === 0) streams.delete(key)
      else if (kept.length !== states.length) streams.set(key, kept)
    }
  }

  return { wrap, status, reap }
}
