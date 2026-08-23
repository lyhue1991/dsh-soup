import { apply } from '../lib/index.js'
import { mkdir, writeFile, rename, readFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 临时工作区：真实 node:fs 验证 move/create/upload + 路径围栏
const WORK = join(tmpdir(), 'dsh-tree-smoke-' + process.pid + '-' + Date.now())
await mkdir(WORK, { recursive: true })

let captured = null
let streamListener = null
let spawned = []
// 会话表：s1 指向 WORK；后续用例可动态加入其他 cwd，验证「会话目录成为允许基」
const sessionHeaders = new Map([['s1', WORK]])
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
  sessions: {
    get: (id) => sessionHeaders.has(id) ? { header: { cwd: sessionHeaders.get(id) } } : undefined,
    list: () => Array.from(sessionHeaders.entries()).map(([id, cwd]) => ({ id, header: { cwd } })),
  },
}
apply(ctx)
if (!captured) throw new Error('route not registered')
if (captured.path !== '/api/dsh-tree') throw new Error('bad path')

// 合法请求头（与 lib/client.js 的 rpc 一致）
const GOOD_HEADERS = {
  host: '127.0.0.1:3080',
  origin: 'http://127.0.0.1:3080',
  'content-type': 'application/json',
  'x-dsh-tree': '1',
}

function call(body, opts = {}) {
  const res = {
    writeHead: (c, h) => { res.code = c; res.headers = h },
    setHeader: (k, v) => { res.headers = Object.assign({}, res.headers, { [k]: v }) },
    end: (b) => { res.body = JSON.parse(b) },
  }
  const payload = JSON.stringify(body)
  captured.handler({
    method: opts.method || 'POST',
    headers: opts.headers || GOOD_HEADERS,
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

// ---- 请求门：跨源 Origin / 非 JSON content-type / 缺自定义头 / 方法 ----
const gOrigin = await call({ action: 'root', args: {} }, {
  headers: Object.assign({}, GOOD_HEADERS, { origin: 'http://evil.example' }),
})
if (gOrigin.code !== 403 || gOrigin.body.ok !== false) throw new Error('cross-origin must 403: ' + JSON.stringify(gOrigin.body))
const gPlain = await call({ action: 'root', args: {} }, {
  headers: Object.assign({}, GOOD_HEADERS, { 'content-type': 'text/plain' }),
})
if (gPlain.code !== 403) throw new Error('text/plain simple request must 403: ' + JSON.stringify(gPlain.body))
const gNoHdr = await call({ action: 'root', args: {} }, {
  headers: { host: GOOD_HEADERS.host, origin: GOOD_HEADERS.origin, 'content-type': 'application/json' },
})
if (gNoHdr.code !== 403) throw new Error('missing x-dsh-tree must 403: ' + JSON.stringify(gNoHdr.body))
const gGet = await call({ action: 'root', args: {} }, { method: 'GET' })
if (gGet.code !== 405) throw new Error('GET must 405, got ' + String(gGet.code))
const gOpt = await call({}, { method: 'OPTIONS' })
if (gOpt.code !== 403) throw new Error('OPTIONS preflight must 403, got ' + String(gOpt.code))

// ---- 路径围栏：越界读写开删全部 403，文件保持原样 ----
const OUT = join(tmpdir(), 'dsh-tree-out-' + process.pid + '-' + Date.now())
await mkdir(OUT, { recursive: true })
const secretPath = join(OUT, 'secret.txt')
await writeFile(secretPath, 'top secret', 'utf8')

const fRead = await call({ action: 'read', args: { path: secretPath } })
if (fRead.body.ok || fRead.code !== 403) throw new Error('out-of-root read must 403: ' + JSON.stringify(fRead.body))
const fWrite = await call({ action: 'write', args: { path: join(OUT, 'pwned.txt'), content: 'x' } })
if (fWrite.body.ok || !String(fWrite.body.error || '').startsWith('unknown action')) {
  throw new Error('write must be removed entirely: ' + JSON.stringify(fWrite.body))
}
const fCreate = await call({ action: 'create', args: { dir: OUT, name: 'x.txt' } })
if (fCreate.body.ok || fCreate.code !== 403) throw new Error('out-of-root create must 403')
const fTrash = await call({ action: 'trash', args: { path: secretPath } })
if (fTrash.body.ok || fTrash.code !== 403) throw new Error('out-of-root trash must 403')
if ((await stat(secretPath)).isFile() !== true) throw new Error('out-of-root file must be untouched')
const fOpen = await call({ action: 'open', args: { path: secretPath } })
if (fOpen.body.ok || fOpen.code !== 403) throw new Error('out-of-root open must 403')

// upload：文件名穿越（../、..\）与越界目录
const fTrav = await call({ action: 'upload', args: { dir: WORK, name: '../escape.txt', data: '' } })
if (fTrav.body.ok) throw new Error('upload ../ traversal must be rejected: ' + JSON.stringify(fTrav.body))
const fTravBsl = await call({ action: 'upload', args: { dir: WORK, name: '..\\escape.txt', data: '' } })
if (fTravBsl.body.ok) throw new Error('upload backslash traversal must be rejected')
const fUpOut = await call({ action: 'upload', args: { dir: OUT, name: 'ok-name.txt', data: '' } })
if (fUpOut.body.ok || fUpOut.code !== 403) throw new Error('upload into out-of-root dir must 403')

// move：目标越界 / 源越界
const inFile = join(WORK, 'mover.txt')
await writeFile(inFile, 'm', 'utf8')
const fMvOut = await call({ action: 'move', args: { from: inFile, to: join(OUT, 'stolen.txt') } })
if (fMvOut.body.ok || fMvOut.code !== 403) throw new Error('move out must 403')
if ((await stat(inFile)).isFile() !== true) throw new Error('source must survive failed move')
const fMvIn = await call({ action: 'move', args: { from: secretPath, to: join(WORK, 'smuggled.txt') } })
if (fMvIn.body.ok || fMvIn.code !== 403) throw new Error('move in from outside must 403')

// 符号链接逃逸（posix）：workspace 内链接指向外部文件，read 必须拒绝
if (process.platform !== 'win32') {
  const link = join(WORK, 'leak-link')
  await symlink(OUT, link)
  const fLink = await call({ action: 'read', args: { path: join(link, 'secret.txt') } })
  if (fLink.body.ok || fLink.code !== 403) throw new Error('symlink escape must 403: ' + JSON.stringify(fLink.body))
}

// 会话 cwd 成为允许基：s2 指向 OUT 后其子树可读可列，移除后立即收窄
sessionHeaders.set('s2', OUT)
const okList = await call({ action: 'list', args: { path: OUT } })
if (!okList.body.ok) throw new Error('session-cwd subtree should be listable: ' + JSON.stringify(okList.body))
const okRead = await call({ action: 'read', args: { path: secretPath } })
if (!okRead.body.ok || okRead.body.content !== 'top secret') throw new Error('session-cwd subtree should be readable: ' + JSON.stringify(okRead.body))
sessionHeaders.delete('s2')
const deniedAgain = await call({ action: 'read', args: { path: secretPath } })
if (deniedAgain.body.ok || deniedAgain.code !== 403) throw new Error('removing session must re-confine')

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

// ---- 流中：滑动窗口瞬时速率（首 chunk 后等 >500ms 再来一个 chunk，tps 应 > 0） ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const options2 = { sessionId: 's10' }
let releaseSecond = null
const gate = new Promise((r) => { releaseSecond = r })
const gatedStream = (async function* () {
  yield { delta: { content: 'a' } }
  await gate
  yield { delta: { content: 'bcdef' } }
})()
const wrapped2 = streamListener(options2, () => Promise.resolve(gatedStream))
const it2 = wrapped2[Symbol.asyncIterator]()
await it2.next() // 首 chunk
await sleep(700) // 让窗口跨度超过 RATE_MIN_SPAN_MS
releaseSecond()
await it2.next() // 第二个 chunk
const mid = await call({ action: 'speed-status', args: { sessionId: 's10' } })
if (mid.body.phase !== 'streaming') throw new Error('expected streaming, got ' + mid.body.phase)
if (!(mid.body.tps > 0)) throw new Error('expected windowed tps > 0: ' + JSON.stringify(mid.body))
try { await it2.return() } catch {}
const afterBreak = await call({ action: 'speed-status', args: { sessionId: 's10' } })
if (afterBreak.body.phase !== 'done') throw new Error('expected done after break, got ' + afterBreak.body.phase)

// ---- 停顿检测：流中超过 STALL_MS 无新 chunk 应回到 waiting，而不是衰减的 t/s ----
const options3 = { sessionId: 's11' }
const stalledStream = (async function* () {
  yield { delta: { content: 'hello' } }
  await sleep(2300)
  yield { delta: { content: 'world' } }
})()
const wrapped3 = streamListener(options3, () => Promise.resolve(stalledStream))
const it3 = wrapped3[Symbol.asyncIterator]()
await it3.next() // 首 chunk
await sleep(2200) // 停顿超过 STALL_MS(2000)
const stalled = await call({ action: 'speed-status', args: { sessionId: 's11' } })
if (stalled.body.phase !== 'waiting') throw new Error('expected waiting on stall, got ' + JSON.stringify(stalled.body))
if (stalled.body.tps !== 0) throw new Error('stall should zero tps: ' + JSON.stringify(stalled.body))
try { await it3.return() } catch {}

// ---- read/write：文本读取（含截断/目录拒绝）、图片 base64、二进制嗅探、写回保存 ----
const txtPath = join(WORK, 'readme.txt')
await writeFile(txtPath, 'hello dsh-tree\n第二行', 'utf8')
const rd1 = await call({ action: 'read', args: { path: txtPath } })
if (!rd1.body.ok || rd1.body.kind !== 'text') throw new Error('read text fail: ' + JSON.stringify(rd1.body))
if (rd1.body.content !== 'hello dsh-tree\n第二行') throw new Error('read text content mismatch')
if (rd1.body.truncated) throw new Error('small file must not be truncated')

const pngPath = join(WORK, 'pixel.png')
await writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]))
const rd2 = await call({ action: 'read', args: { path: pngPath } })
if (!rd2.body.ok || rd2.body.kind !== 'image' || rd2.body.mime !== 'image/png') throw new Error('read image fail: ' + JSON.stringify(rd2.body))
if (Buffer.from(rd2.body.data, 'base64').length !== 7) throw new Error('image base64 mismatch')

const binPath = join(WORK, 'blob.dat')
await writeFile(binPath, Buffer.concat([Buffer.alloc(100, 0x41), Buffer.from([0x00]), Buffer.alloc(10, 0x42)]))
const rd3 = await call({ action: 'read', args: { path: binPath } })
if (!rd3.body.ok || rd3.body.kind !== 'binary') throw new Error('binary sniff fail: ' + JSON.stringify(rd3.body))

const pdfPath = join(WORK, 'probe.pdf')
await writeFile(pdfPath, Buffer.from('%PDF-1.4\n1 0 obj\n<</Type/Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF', 'latin1'))
const rdPdf = await call({ action: 'read', args: { path: pdfPath } })
if (!rdPdf.body.ok || rdPdf.body.kind !== 'pdf') throw new Error('pdf read must be kind=pdf: ' + JSON.stringify(rdPdf.body))
if (!String(rdPdf.body.data).startsWith('JVBER')) throw new Error('pdf base64 must round-trip')

const dirRead = await call({ action: 'read', args: { path: WORK } })
if (dirRead.body.ok) throw new Error('directory read should fail')

const wr1 = await call({ action: 'write', args: { path: txtPath, content: 'nope' } })
if (wr1.body.ok) throw new Error('write should be removed (preview-only): ' + JSON.stringify(wr1.body))
if (!String(wr1.body.error || '').startsWith('unknown action')) throw new Error('write must be unknown action: ' + JSON.stringify(wr1.body))
const rd4 = await call({ action: 'read', args: { path: txtPath } })
if (!rd4.body.ok || rd4.body.content !== 'hello dsh-tree\n第二行') throw new Error('read after removed write must be unchanged')

const missingRead = await call({ action: 'read', args: { path: join(WORK, 'nope.txt') } })
if (missingRead.body.ok) throw new Error('missing read should fail')

// ---- 空包滴漏护栏：等待期无文本的 keepalive delta 不能伪装成慢速流式 ----
const options4 = { sessionId: 's12' }
let releaseTrickle = null
const trickleGate = new Promise((r) => { releaseTrickle = r })
const trickledStream = (async function* () {
  yield { delta: { content: '一二三四五六七八九十' } } // 内容 burst（10 个 CJK 估算 token）
  for (let i = 0; i < 6; i++) {
    await sleep(300)
    yield { delta: {} } // 无文本空包：只刷新 chunk 时钟，不刷新内容时钟
    if (i === 2) await trickleGate
  }
})()
const wrapped4 = streamListener(options4, () => Promise.resolve(trickledStream))
const it4 = wrapped4[Symbol.asyncIterator]()
await it4.next() // 内容 burst
await it4.next(); await it4.next(); await it4.next() // 三个空包 ≈ 900ms
const trickleStatus = await call({ action: 'speed-status', args: { sessionId: 's12' } })
if (trickleStatus.body.phase !== 'waiting' || trickleStatus.body.tps !== 0) {
  throw new Error('empty-delta trickle must read waiting, got ' + JSON.stringify(trickleStatus.body))
}
releaseTrickle()
try { await it4.return() } catch {}

// ---- 分母稀释修复：内容脉冲后的静默期不得把速率摊薄成 0.x t/s ----
const options5 = { sessionId: 's13' }
let releaseBurst = null
const burstGate = new Promise((r) => { releaseBurst = r })
const burstStream = (async function* () {
  yield { delta: { content: 'hello world this is a steady burst of text tokens' } }
  await burstGate // 静默期挂起（< STALL_MS）
  yield { delta: { content: 'more' } }
})()
const wrapped5 = streamListener(options5, () => Promise.resolve(burstStream))
const it5 = wrapped5[Symbol.asyncIterator]()
await it5.next() // burst
await sleep(1200) // 静默 1.2s（超过 RATE_MIN_SPAN_MS，未到 STALL_MS）
const decayed = await call({ action: 'speed-status', args: { sessionId: 's13' } })
// 内容停顿 ≥500ms 后，任何低于真实生成下限的读数都判等待，而不是衰减的小数速率
if (decayed.body.phase !== 'waiting' || decayed.body.tps !== 0) {
  throw new Error('post-burst silence must read waiting, got ' + JSON.stringify(decayed.body))
}
releaseBurst()
try { await it5.return() } catch {}

await rm(WORK, { recursive: true, force: true })
await rm(OUT, { recursive: true, force: true })
console.log('SMOKE OK: root, sessionCwd, create, upload, move(no-shell), list, open, trash, guard, read(text/image/binary/dir-miss), write-removed(preview-only), speed idle/waiting/streaming-tps/done/stall, gate(origin/header/method), confine(out-of-root/traversal/symlink/session-base)')
