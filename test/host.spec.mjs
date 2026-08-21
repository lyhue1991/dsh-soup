import { apply } from '../lib/index.js'

let captured = null
let streamListener = null
const ctx = {
  effect: (fn) => { const d = fn(); return () => { if (d) d() } },
  on: (name, fn) => { if (name === 'llm/stream') streamListener = fn; return () => { if (name === 'llm/stream') streamListener = null } },
  timer: { interval: () => () => {} },
  webServer: { register: (route) => { captured = route; return () => { captured = null } } },
  fs: {
    resolve: async (p) => ({ displayPath: p }),
    listDir: async (t) => [
      { name: 'a.txt', type: 'file', size: 0, target: { displayPath: t.displayPath + '/a.txt' } },
      { name: 'sub', type: 'directory', target: { displayPath: t.displayPath + '/sub' } },
    ],
  },
  subprocess: {
    spawn: (spec) => ({ done: Promise.resolve({ exitCode: 0 }) }),
  },
  sandboxPolicy: { workspaceRoot: '/tmp/dsh-tree-smoke' },
  sessions: { get: (id) => id === 's1' ? { header: { cwd: '/tmp/dsh-tree-smoke' } } : undefined },
}
apply(ctx)
if (!captured) throw new Error('route not registered')
if (captured.path !== '/api/dsh-tree') throw new Error('bad path')

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
const r1 = await call({ action: 'root', args: {} })
if (!r1.body.ok || r1.body.root !== '/tmp/dsh-tree-smoke') throw new Error('root fail: ' + JSON.stringify(r1.body))
const r2 = await call({ action: 'sessionCwd', args: { sessionId: 's1' } })
if (!r2.body.ok || r2.body.cwd !== '/tmp/dsh-tree-smoke') throw new Error('cwd fail')
const r3 = await call({ action: 'sessionCwd', args: { sessionId: 'nope' } })
if (r3.body.ok) throw new Error('cwd should fail')
const r4 = await call({ action: 'list', args: { path: '/tmp/dsh-tree-smoke' } })
if (!r4.body.ok || r4.body.entries.length !== 2 || r4.body.entries[0].name !== 'a.txt') throw new Error('list fail: ' + JSON.stringify(r4.body))
const r5 = await call({ action: 'open', args: { path: '/x' } })
if (!r5.body.ok) throw new Error('open fail')
const r6 = await call({ action: 'create', args: { dir: '/tmp/dsh-tree-smoke', name: 'x/y', isDir: true } })
if (r6.body.ok) throw new Error('create should reject bad name')
const r7 = await call({ action: 'unknown', args: {} })
if (r7.body.ok) throw new Error('unknown should fail')

// ---- speed-status：无流时 idle；有流后按 chunk 累计 ----
const s0 = await call({ action: 'speed-status', args: { sessionId: 's9' } })
if (s0.body.phase !== 'idle') throw new Error('speed should be idle: ' + JSON.stringify(s0.body))

// 模拟 llm/stream：waiting → streaming（首 chunk）→ done
const options = { sessionId: 's9' }
const nextStream = (async function* () {
  yield { delta: { content: '你' } }
  yield { delta: { content: '好，世界' } }
  yield { usage: { outputTokens: 5 } }
})()
const wrapped = streamListener(options, () => Promise.resolve(nextStream))
// 消费前先查一次：应处于 waiting
const w1 = await call({ action: 'speed-status', args: { sessionId: 's9' } })
if (w1.body.phase !== 'waiting') throw new Error('expected waiting, got ' + w1.body.phase)

// 消费整个流
for await (const _c of wrapped) { /* drain */ }
const w2 = await call({ action: 'speed-status', args: { sessionId: 's9' } })
if (w2.body.phase !== 'done') throw new Error('expected done, got ' + w2.body.phase)
if (typeof w2.body.tokens !== 'number' || w2.body.tokens < 0) throw new Error('bad tokens: ' + JSON.stringify(w2.body))
if (w2.body.tps !== 0) throw new Error('tps should be 0 after done: ' + JSON.stringify(w2.body))

console.log('SMOKE OK: root, sessionCwd, list, open, create-guard, unknown-guard, speed idle/waiting/stream/done')
