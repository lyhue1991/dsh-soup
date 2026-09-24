---
name: debug-dsh-plugin
description: Debug DeepSeek Harness (DSH / dsh-desktop) desktop app and its plugins. Use when a DSH plugin or UI element is invisible, crashed, mispositioned, or stale; when bundles load but render nothing; when you need to verify code changes actually took effect in the running app; or when asked to inspect DSH slots, host RPC routes, or llm/stream data. Covers safe restart with process verification, CDP (Chrome DevTools Protocol) renderer probes, host-side HTTP RPC testing, AX-tree interaction, and Cordis slot-system pitfalls.
---

# Debug DSH

## Overview

DeepSeek Harness is an Electron multi-process app whose renderer loads a merged
client bundle from an asar plus link:-installed user plugins from
`~/.dsh/profiles/<profile>/node_modules`. Debugging is a three-layer job:
identify the layer first (host vs renderer vs plugin registration), then probe it
directly. The #1 time-waster is stale code: verify the running process postdates
your build before concluding anything about behavior.

## Layer triage

Run checks top-down; stop when one fails:

1. **New bundle loaded?** Process start time > client bundle mtime, and a
   fingerprint string from your edit appears in the runtime factory source (see
   CDP below).
2. **Host half OK?** Call the plugin's HTTP RPC directly with curl. For dsh-soup:
   `POST http://127.0.0.1:<port>/api/dsh-soup` with headers
   `content-type: application/json` + `x-dsh-soup: 1`, body
   `{"action":"speed-status","args":{}}`. Find the port with
   `lsof -iTCP -sTCP:LISTEN | rg -i 'deepseek|dsh'`.
3. **Renderer half OK?** CDP probe: bundle globals present -> slot container
   present -> slot entries present -> entry has error attribute (see CDP below).

## Restart safely (scripts/dsh_restart.sh)

`open -a DSH --args --remote-debugging-port=9223` silently does nothing if any
DSH process survives — and DSH spawns multiple. The script quits, kills
leftovers in a loop, verifies zero processes, relaunches, and polls CDP until
ready:

```bash
<repo>/skills/debug-dsh-plugin/scripts/dsh_restart.sh 9223   # with CDP
<repo>/skills/debug-dsh-plugin/scripts/dsh_restart.sh        # plain restart
```

After a restart, prove the new bundle is live before diagnosing behavior: from
CDP, evaluate
`window.__PLUGIN_GLOBAL__.factoryFn.toString().includes('<new-source-token>')`.

## CDP renderer probe (scripts/cdp_probe.mjs)

Requires the `ws` npm package available (e.g. `cd /tmp/cdp-probe && npm i ws`
once) and the app running with a debug port. `DSH_CDP_PORT` selects the port
(default 9222).

```bash
cd /tmp/cdp-probe && npm i ws --no-audit --no-fund
node <repo>/skills/debug-dsh-plugin/scripts/cdp_probe.mjs
    # mount probe: soup globals, header slots, slot children
    # (error attr, data-phase, text)
node cdp_probe.mjs 'document.title' # any inline expression
node cdp_probe.mjs @/tmp/expr.js    # expression from file (awaitPromise on)
```

Reading the mount probe:

- `soupGlobals` empty -> plugin bundle did not load at all.
- Entry has `"error": "<slot-name>"` -> the component threw during render
  (DSH replaces it with `<div data-slot-error="...">`). Get the real stack:
  subscribe `Runtime.consoleAPICalled` (type error) and
  `Runtime.exceptionThrown` over CDP, then `Page.reload`; DSH logs
  `slot entry crashed in '<slot>': ...` with the stack.
- Entry absent but container exists -> registration never reached the render
  tree (slot-scope problem, see pitfalls) — no error is logged.
- Entry present with `display: none` -> mounted and idle; idle invisibility is
  expected behavior, not a bug. Trigger a streaming turn to see live state.

To fetch the *runtime* source of a merged bundle (for mapping a stack line
number), fetch its script URL from inside the page and split by newline. Local
files rarely align with the merged bundle's line numbers.

## AX-tree interaction (cua)

- Element indices shift on every `getAXState()`; re-read and re-match
  immediately before each click/setValue.
- `paste` beats `typeText` for CJK text; wait ~2s after Return and re-read the
  tree to confirm the turn actually started (messages can queue instead of
  sending).
- Use the app-level window screenshot (cua `getScreenshot`); `screencapture -x`
  captures the whole screen and often grabs the wrong foreground window.
- The user may be using another session/window — check the selected session row
  before injecting input, and prefer passive observation (poll CDP while the
  user exercises the app) over sending messages for them.

## Cordis slot pitfalls (DSH plugin API)

1. **Two-phase registration is mandatory** for session-scoped list slots:
   `slots.inject('<slot>', () => slots.register({...}, Component))`.
   A bare `slots.register` never renders and logs nothing.
2. **Prop names come from the slot contract** — e.g. session slots pass
   `sessionId` (not `session`). Verify in the DSH package sources
   (asar unpack or the asar inside the app bundle) before wiring.
3. **No conditional hook calls.** `if (cond) value = useSessions(...)` breaks the
   hook chain on re-render and surfaces as a cryptic
   `RangeError: Invalid array length at <ComponentName>` with a merged-bundle
   stack. Call every hook unconditionally at the top of the component.
4. Keep a hidden probe span (`display:none` + `data-phase`) in your component's
   idle state so "not mounted" vs "mounted but idle" is distinguishable via CDP.
5. DSH's own footer stats ("N 轮 M 步 · X tok/s") are official UI — do not
   confuse them with plugin badges when judging visibility.

## Debugging workflow (checklist)

1. `git diff` + `npm run build` -> note client bundle mtime.
2. `dsh_restart.sh 9223` -> confirm "CDP ready".
3. Fingerprint check via CDP: new source token present in runtime factory.
4. `cdp_probe.mjs` mount probe -> triage per "Reading the mount probe".
5. If crash: reload with console listener -> capture stack -> fetch runtime
   bundle source -> fix source (hook order, missing prop, undefined helper).
6. If invisible-but-no-error: check slot registration pattern (two-phase) and
   slot props contract.
7. Verify host independently with curl before touching renderer code.
8. For streaming-UI features, reproduce by sending a short message via AX tree
   (or asking the user), then poll the probe every ~500ms during the turn.
