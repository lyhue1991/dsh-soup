/**
 * 官方 file 地址解析（纯函数，无 DOM/React 依赖）。
 *
 * dsh-soup 遮蔽 rightbar 槽位后，官方 SidebarRight 面板组件永不挂载，
 * 会话里的文件产物卡片 / 内联文件链接调用
 * ctx.sidebarRight.openResource('dsh-resource://file/…') 会抛
 * "sidebarRight: no session surface is mounted"。main 侧把这里的解析结果
 * 转投 dsh-soup 自己的预览 tab（openFileInTab）。
 */

/** 官方 file 地址前缀。 */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

export function decodeSegmentSafe(segment) {
  try { return decodeURIComponent(segment) } catch (e) { return null }
}

/** 解析官方 file 地址；非 file 地址或编码非法返回 null（与 workspace-path 同规则）。 */
export function parseFileAddress(address) {
  if (typeof address !== 'string' || address.indexOf(FILE_ADDRESS_PREFIX) !== 0) return null
  var end = address.search(/[?#]/)
  var body = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
  var parts = body.split('/')
  if (parts[0] === 'session') {
    var sessionId = decodeSegmentSafe(parts[1] || '')
    if (!sessionId) return null
    var segments = []
    for (var i = 2; i < parts.length; i++) {
      var seg = decodeSegmentSafe(parts[i])
      if (seg === null) return null
      segments.push(seg)
    }
    if (!segments.length) return null
    return { scope: 'session', sessionId: sessionId, path: segments.join('/') }
  }
  if (parts[0] === 'absolute') {
    var absolute = []
    for (var j = 1; j < parts.length; j++) {
      var abs = decodeSegmentSafe(parts[j])
      if (abs === null) return null
      absolute.push(abs)
    }
    if (!absolute.length) return null
    return { scope: 'absolute', path: '/' + absolute.join('/') }
  }
  return null
}

/** 同步判断：该 file 地址是否应由 dsh-soup 接住（当前会话或绝对路径）。 */
export function fileAddressMatches(address, sessionIdHint, activeSessionId) {
  var parsed = parseFileAddress(address)
  if (!parsed) return false
  if (parsed.scope === 'session' && (sessionIdHint || parsed.sessionId) !== activeSessionId) return false
  return true
}

