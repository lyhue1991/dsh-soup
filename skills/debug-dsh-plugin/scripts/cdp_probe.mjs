#!/usr/bin/env node
// DSH renderer probe via CDP (--remote-debugging-port=9222).
// Usage: node cdp_probe.mjs [expression-file | inline-expression]
//   - No args: run the standard mount/status probe (soup badge, slots, globals).
//   - With arg: evaluate the given expression (or a file path containing it),
//     printing JSON result. Use Page='reload' to reload and dump console errors.
import WebSocket from 'ws'
import { readFileSync } from 'node:fs'

const PORT = process.env.DSH_CDP_PORT || 9222

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = list.find((p) => p.type === 'page') || list[0]
  if (!page) throw new Error('no DSH page found on CDP; is the app running with --remote-debugging-port?')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  await new Promise((r) => ws.on('open', r))
  return {
    send: (method, params = {}) => new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    }),
    close: () => ws.close(),
  }
}

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const q = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, catchPromiseRejection: true })
  if (q.result?.exceptionDetails) return { error: q.result.exceptionDetails.exception?.description || q.result.exceptionDetails.text }
  return q.result?.result?.value
}

const MOUNT_PROBE = `JSON.stringify((() => {
  const slot = document.querySelector('[data-slot=conversation\\\\.session\\\\.header\\\\.actions]')
  return {
    soupGlobals: Object.keys(window).filter((k) => k.startsWith('__DSH_SOUP')),
    headerSlots: [...document.querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot')).filter((s) => s.includes('header')),
    actionsSlotChildren: slot ? [...slot.children].map((c) => ({ tag: c.tagName, cls: c.className, error: c.getAttribute('data-slot-error'), phase: c.dataset.phase, text: (c.textContent || '').slice(0, 60) })) : null,
  }
})())`

const cdp = await connect()
await cdp.send('Runtime.enable')

const arg = process.argv[2]
if (!arg) {
  console.log(JSON.stringify(await evaluate(cdp, MOUNT_PROBE), null, 1))
} else if (arg === 'reload') {
  const errs = []
  // Errors surface as console.error invocations with the full stack in args.
  const origSend = cdp.send.bind(cdp)
  await cdp.send('Page.enable')
  process.on('message', () => {})
  const wsRaw = cdp
  console.log('reloading; errors will print below...')
  await origSend('Page.reload')
  await new Promise((r) => setTimeout(r, 7000))
  console.log(JSON.stringify(await evaluate(cdp, MOUNT_PROBE), null, 1))
} else {
  const expr = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg
  const result = await evaluate(cdp, expr, { awaitPromise: true })
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1))
}
cdp.close()
