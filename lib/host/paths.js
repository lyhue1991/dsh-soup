import path from 'node:path'
import { realpath } from 'node:fs/promises'

/** Workspace and session-directory boundary for host-side file operations. */
export function createPathGuard({ root, sessions, platform = process.platform }) {
  const foldCase = platform === 'win32'
  let rootRealCache = null

  function httpError(statusCode, message) {
    return Object.assign(new Error(message), { statusCode })
  }

  async function realPathLenient(value) {
    let current = path.resolve(String(value))
    const tail = []
    for (;;) {
      try {
        const resolved = await realpath(current)
        return tail.length ? path.join(resolved, ...tail) : resolved
      } catch (error) {
        const parent = path.dirname(current)
        if (!error || error.code !== 'ENOENT' || parent === current) throw error
        tail.unshift(path.basename(current))
        current = parent
      }
    }
  }

  async function rootReal() {
    if (rootRealCache === null) {
      try { rootRealCache = await realpath(root) } catch { rootRealCache = path.resolve(root) }
    }
    return rootRealCache
  }

  function within(base, candidate) {
    const left = foldCase ? base.toLowerCase() : base
    const right = foldCase ? candidate.toLowerCase() : candidate
    if (left === right) return true
    const relative = path.relative(left, right)
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
  }

  async function allowedBases(preferredSessionId) {
    const bases = [await rootReal()]
    const push = async (cwd) => {
      if (typeof cwd !== 'string' || !cwd) return
      try { bases.push(await realPathLenient(cwd)) } catch { /* unavailable cwd */ }
    }
    if (preferredSessionId && typeof sessions.get === 'function') {
      try { await push(sessions.get(preferredSessionId)?.header?.cwd) } catch { /* ignore */ }
    }
    try {
      const list = typeof sessions.list === 'function' ? sessions.list() : []
      for (const session of list) await push(session?.header?.cwd)
    } catch { /* workspace root remains available */ }
    return bases
  }

  async function confine(rawPath, label, preferredSessionId) {
    const name = label || '路径'
    const input = String(rawPath || '')
    if (!input) throw httpError(400, '缺少' + name)
    let resolved
    try { resolved = await realPathLenient(input) } catch { throw httpError(400, name + '不可达: ' + input) }
    for (const base of await allowedBases(preferredSessionId)) if (within(base, resolved)) return resolved
    throw httpError(403, name + '超出允许范围（仅限工作区与会话目录）: ' + input)
  }

  return { confine, within, realPathLenient, httpError }
}
