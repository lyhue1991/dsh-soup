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
  try {
    if (!chunk) return { text, realTokens }
    if (typeof chunk.text === 'string') text += chunk.text
    if (typeof chunk.content === 'string') text += chunk.content
    if (Array.isArray(chunk.content)) for (const part of chunk.content) if (typeof part?.text === 'string') text += part.text
    if (chunk.delta) {
      if (typeof chunk.delta.text === 'string') text += chunk.delta.text
      if (typeof chunk.delta.content === 'string') text += chunk.delta.content
      realTokens = outputTokens(chunk.delta.usage) ?? realTokens
    }
    realTokens = outputTokens(chunk.usage) ?? realTokens
    if (Array.isArray(chunk.choices)) {
      for (const choice of chunk.choices) {
        if (typeof choice?.delta?.content === 'string') text += choice.delta.content
        realTokens = outputTokens(choice?.delta?.usage) ?? realTokens
      }
    }
  } catch { /* best-effort metrics must never interfere with output */ }
  return { text, realTokens }
}

export function createSpeedTracker() {
  const streams = new Map()

  function wrap(options, next) {
    const key = sessionKey(options) || '_'
    const now = Date.now()
    streams.set(key, { phase: 'waiting', startedAt: now, firstChunkAt: null, charTokens: 0, realTokens: 0, hasReal: false, lastChunkAt: null, lastContentAt: null, samples: [], lastSeen: now })
    const innerPromise = Promise.resolve(next())
    return (async function* () {
      try {
        const inner = await innerPromise
        for await (const chunk of inner) {
          const state = streams.get(key)
          if (state) {
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
          }
          yield chunk
        }
      } finally {
        const state = streams.get(key)
        if (state) { state.phase = 'done'; state.lastSeen = Date.now() }
      }
    })()
  }

  function status(sessionId) {
    let state = streams.get(sessionId)
    if (!state) {
      for (const candidate of streams.values()) if (!state || candidate.lastSeen > state.lastSeen) state = candidate
    }
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
    for (const [key, state] of streams) if (state.phase === 'done' && now - state.lastSeen > 4000) streams.delete(key)
  }

  return { wrap, status, reap }
}
