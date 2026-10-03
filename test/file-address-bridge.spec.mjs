import test from 'node:test'
import assert from 'node:assert/strict'
import { bridgeFileAddressOpener } from '../lib/client/file-address-bridge.js'

const address = 'dsh-resource://file/session/current/reports/output.md'

test('bridges current-session file resources into the soup preview', () => {
  const calls = []
  const service = {
    openResource: (...args) => { calls.push(['original', ...args]); return 'original result' },
  }
  const opened = []
  const dispose = bridgeFileAddressOpener(service, {
    getActiveSessionId: () => 'current',
    openFileAddressInSoup: (value, sessionId) => { opened.push([value, sessionId]); return Promise.resolve(true) },
  })

  assert.equal(typeof dispose, 'function')
  assert.equal(service.openResource(address), undefined)
  assert.deepEqual(opened, [[address, null]])
  assert.deepEqual(calls, [])

  assert.equal(service.openResource('dsh-resource://other/session/current/x'), 'original result')
  assert.deepEqual(calls, [['original', 'dsh-resource://other/session/current/x', undefined]])

  dispose()
  assert.equal(service.openResource(address), 'original result')
  assert.deepEqual(calls.at(-1), ['original', address])
  assert.equal(service.__dshSoupFileBridge, undefined)
})

test('does not hijack a file address from another session', () => {
  const calls = []
  const service = {
    openResource: (...args) => { calls.push(args); return 'original result' },
    openResourceIn: (...args) => { calls.push(args); return 'original-in result' },
  }
  const dispose = bridgeFileAddressOpener(service, {
    getActiveSessionId: () => 'current',
    openFileAddressInSoup: () => { throw new Error('must not open') },
  })

  assert.equal(service.openResourceIn('other', 'dsh-resource://file/session/other/x.txt'), 'original-in result')
  assert.deepEqual(calls, [['other', 'dsh-resource://file/session/other/x.txt', undefined]])
  dispose()
})
