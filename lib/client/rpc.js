/** Browser-side bridge for the host's same-origin JSON RPC endpoint. */
export function createRpc({ translate, location = globalThis.location, fetchImpl = globalThis.fetch }) {
  function hostBase() {
    const origin = location && location.origin
    return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
  }

  return function rpc(action, args) {
    return fetchImpl(new URL('/api/dsh-soup', hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-soup': '1' },
      body: JSON.stringify({ action, args: args || {} }),
    }).then((response) => response.json().catch(() => ({ ok: false, error: translate('explorer.hostBadResponse') })))
      .catch((error) => ({ ok: false, error: translate('explorer.hostUnreachable', { reason: String(error?.message || error) }) }))
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_RPC__ = { createRpc }
