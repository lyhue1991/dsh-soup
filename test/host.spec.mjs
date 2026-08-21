import { apply } from '../lib/index.js'
import { mkdir, writeFile, rename, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 临时工作区：真实 node:fs 验证 move/create/upload
const WORK = join(tmpdir(), 'dsh-tree-smoke-' + process.pid + '-' + Date.now())
await mkdir(WORK, { recursive: true })

let captured = null
let streamListener = null
let spawned = []
const ctx = {
  effect: (fn) => { const d = fn(); return () => { if (d) d() } },
  on: (name, fn) => { if (name === 'llm/stream') streamListener = fn; return () => { if (name === 'llm/stream') streamListener = null } },
  timer: { interval: () => () => {} },
  webServer: { register: (route) => { captured = route; return () => { captured = null } } },
  fs: {
    resolve: async (p) => ({ displayPath: p }),
    listDir: async (t) => (await readdir(t.displayPath)).map((name) => {
      const target = { displayPath: join(t.displayPath, name) }
      return { name, type: 'file', target }
    }),
  },
  subprocess: {
    spawn: (spec) => { spawned.push(spec.argv); return { done: Promise.resolve({ exitCode: 0 }) } },
  },
  sandboxPolicy: { workspaceRoot: WORK },
  sessions: { get: (id) => id === 's1' ? { header: { cwd: WORK } } : undefined },
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
if (!r1.body.ok || r1.body.root !== WORK) throw new Error('root fail: ' + JSON.stringify(r1.body))
const r2 = await call({ action: 'sessionCwd', args: { sessionId: 's1' } })
if (!r2.body.ok || r2.body.cwd !== WORK) throw new Error('cwd fail')
const r3 = await call({ action: 'sessionCwd', args: { sessionId: 'nope' } })
if (r3.body.ok) throw new Error('cwd should fail')

// ---- create：真实建目录 / 建文件 ----
const c1 = await call({ action: 'create', args: { dir: WORK, name: 'subdir', isDir: true } })
if (!c1.body.ok) throw new Error('mkdir fail: ' + JSON.stringify(c1.body))
const c2 = await call({ action: 'create', args: { dir: WORK, name: 'hello.txt', isDir: false } })
if (!c2.body.ok) throw new Error('touch fail: ' + JSON.stringify(c2.body))
if ((await stat(join(WORK, 'hello.txt'))).isFile() !== true) throw new Error('hello.txt not created')
const c3 = await call({ action: 'create', args: { dir: WORK, name: 'x/y', isDir: true } })
if (c3.body.ok) throw new Error('create should reject bad name')

// ---- upload：base64 解码真实写盘 ----
const b64 = Buffer.from('hello world 你好').toString('base64')
const u1 = await call({ action: 'upload', args: { dir: WORK, name: 'bin.dat', data: b64 } })
if (!u1.body.ok) throw new Error('upload fail: ' + JSON.stringify(u1.body))
const up = await readFile(join(WORK, 'bin.dat'), 'utf8')
if (up !== 'hello world 你好') throw new Error('upload content mismatch: ' + JSON.stringify(up))

// ---- move：真实改名 ----
const m1 = await call({ action: 'move', args: { from: join(WORK, 'hello.txt'), to: join(WORK, 'renamed.txt') } })
if (!m1.body.ok) throw new Error('move fail: ' + JSON.stringify(m1.body))
if ((await stat(join(WORK, 'renamed.txt'))).isFile() !== true) throw new Error('renamed.txt missing')
if (spawned.some((a) => a.join(' ').includes('mv'))) throw new Error('move must NOT shell out to mv')

// ---- list：读到真实文件 ----
const l1 = await call({ action: 'list', args: { path: WORK } })
if (!l1.body.ok) throw new Error('list fail: ' + JSON.stringify(l1.body))
const names = l1.body.entries.map((e) => e.name).sort()
if (names.join(',') !== 'bin.dat,renamed.txt,subdir') throw new Error('list mismatch: ' + names.join(','))

// ---- open / trash：走 subprocess（平台分支命令） ----
const o1 = await call({ action: 'open', args: { path: join(WORK, 'renamed.txt') } })
if (!o1.body.ok) throw new Error('open fail: ' + JSON.stringify(o1.body))
if (spawned.length === 0) throw new Error('open should spawn a command')
const t1 = await call({ action: 'trash', args: { path: join(WORK, 'renamed.txt') } })
if (!t1.body.ok) throw new Error('trash fail: ' + JSON.stringify(t1.body))

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

await rm(WORK, { recursive: true, force: true })
console.log('SMOKE OK: root, sessionCwd, create, upload, move(no-shell), list, open, trash, guard, speed idle/waiting/done')
