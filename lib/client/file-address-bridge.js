import { fileAddressMatches } from './file-address.js'

/**
 * Wrap the official Sidebar resource opener so file resources keep working
 * when dsh-soup owns the right-column surface.  The service is intentionally
 * passed in by the caller: it can be provided after this plugin's apply()
 * lifecycle has already started, and may be replaced on a host reconnect.
 */
export function bridgeFileAddressOpener(service, ctx) {
  if (!service || typeof service.openResource !== 'function') return null
  if (service.__dshSoupFileBridge) return null

  var originalOpenResource = service.openResource
  var originalOpenResourceIn = service.openResourceIn
  var openFileAddressInSoup = ctx.openFileAddressInSoup
  var getActiveSessionId = ctx.getActiveSessionId

  function openInSoup(address, sessionIdHint) {
    if (!fileAddressMatches(address, sessionIdHint, getActiveSessionId())) return false
    try {
      var task = openFileAddressInSoup(address, sessionIdHint)
      // Sidebar actions are synchronous. Keep asynchronous preview failures
      // from becoming unhandled rejections in the host click handler.
      if (task && typeof task.catch === 'function') task.catch(function () {})
      return true
    } catch (err) {
      return false
    }
  }

  var bridgedOpenResource = function (address, options) {
    if (openInSoup(address, null)) return undefined
    return originalOpenResource.call(this, address, options)
  }
  var bridgedOpenResourceIn = typeof originalOpenResourceIn === 'function'
    ? function (sessionId, address, options) {
      if (openInSoup(address, sessionId)) return undefined
      return originalOpenResourceIn.call(this, sessionId, address, options)
    }
    : null

  try {
    service.openResource = bridgedOpenResource
    if (bridgedOpenResourceIn) service.openResourceIn = bridgedOpenResourceIn
    if (service.openResource !== bridgedOpenResource ||
        (bridgedOpenResourceIn && service.openResourceIn !== bridgedOpenResourceIn)) return null
    try { Object.defineProperty(service, '__dshSoupFileBridge', { value: true, configurable: true }) }
    catch (err) { service.__dshSoupFileBridge = true }
  } catch (err) {
    try {
      if (service.openResource === bridgedOpenResource) service.openResource = originalOpenResource
      if (bridgedOpenResourceIn && service.openResourceIn === bridgedOpenResourceIn) {
        service.openResourceIn = originalOpenResourceIn
      }
    } catch (restoreErr) {}
    return null
  }

  return function () {
    if (service.openResource === bridgedOpenResource) service.openResource = originalOpenResource
    if (bridgedOpenResourceIn && service.openResourceIn === bridgedOpenResourceIn) {
      service.openResourceIn = originalOpenResourceIn
    }
    try { delete service.__dshSoupFileBridge } catch (err) {}
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_FILE_ADDRESS_BRIDGE__ = { bridgeFileAddressOpener }
