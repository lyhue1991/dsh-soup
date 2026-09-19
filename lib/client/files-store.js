import { parseFileAddress } from './file-address.js'
import { isEditableTextFile } from './preview-renderers.js'

/**
 * files tab 状态机（区域二 · 🫚 姜）：打开/重载/关闭、FIFO(≤5)、编辑草稿、
 * mtime/size 防冲突保存、会话切换按 cwd 裁剪、官方 file 地址桥接入口。
 * 经 createFilesStore(ctx) 注入 T/rpc/state 访问器，保持 apply 生命周期
 * 内 locale 重绑定行为。状态本体仍存宿主 store（state.files）。
 */
export function createFilesStore(ctx) {
  var T = ctx.T
  var rpc = ctx.rpc
  var setState = ctx.setState
  var getState = ctx.getState
  var refresh = ctx.refresh
  var baseName = ctx.baseName
  var defaultCwd = ctx.defaultCwd
  var getActiveSessionId = ctx.getActiveSessionId

  var FILES_TAB_LABEL = function () { return T('files.tab') }

  /** 同时打开的预览 tab 上限：超过后挤掉最早打开的（FIFO）。 */
  var FILES_MAX_OPEN = 5

  var autoSaveTimers = new Map()
  var autoSaveSavedTimers = new Map()
  var manualSavePaths = new Set()
  var AUTO_SAVE_DELAY_MS = 5000
  var SAVED_INDICATOR_MS = 1500

  /** path 是否落在 base 目录子树内（base 为根或空时视为全量放行）。 */
  function withinScope(path, base) {
    if (!base || base === '/') return true
    return path === base || path.indexOf(base + '/') === 0
  }

  /**
   * 会话切换时按新 cwd 裁剪预览列表：范围外的 tab 自动关闭。
   * 若当前激活文件被裁掉，激活项顺移到剩余最后一个。
   * 列表无变化时返回原引用，避免触发多余渲染。
   */
  function pruneFilesToScope(files, cwd) {
    var kept = files.list.filter(function (f) { return withinScope(f.path, cwd) })
    try { window.__DFV_PRUNE = (window.__DFV_PRUNE || []) ; window.__DFV_PRUNE.push({ cwd: cwd, before: files.list.length, after: kept.length }) } catch (_) {}
    if (kept.length === files.list.length) return files
    var activeKept = kept.some(function (f) { return f.path === files.active })
    var active = files.active
    if (!activeKept) active = kept.length ? kept[kept.length - 1].path : null
    return { list: kept, active: active }
  }

  function setFiles(patch) {
    setState({ files: Object.assign({}, getState().files, patch) })
    try {
      var f = getState().files
      window.__DFV_DBG = { n: f.list.length, active: f.active, ops: ((window.__DFV_DBG && window.__DFV_DBG.ops) || 0) + 1 }
    } catch (_) {}
  }

  function askOverwrite(name) {
    return new Promise(function (resolve) {
      setState({ uploadConflict: { name: name, resolve: resolve } })
    })
  }

  function findFileEntry(path) {
    var list = getState().files.list
    for (var i = 0; i < list.length; i++) {
      if (list[i].path === path) return list[i]
    }
    return null
  }

  /** 点击原生 header 的「预览」tab，把 view ring 切到预览视图。 */
  function activateFilesView() {
    try {
      var label = FILES_TAB_LABEL()
      var tabs = document.querySelectorAll('[role="tab"]')
      for (var i = 0; i < tabs.length; i++) {
        // 新版标签渲染可能引入空白节点，textContent 统一 trim 后比较
        if (String(tabs[i].textContent || '').trim() === label) { tabs[i].click(); return true }
      }
    } catch (err) {}
    return false
  }

  async function openFileInTab(path) {
    setState({ menu: null })
    var entry = findFileEntry(path)
    if (!entry) {
      entry = {
        path: path, name: baseName(path),
        loading: true, loaded: false, error: '',
        kind: null, content: '', dataUrl: '', data: '',
        truncated: false, size: 0,
        baseContent: '', baseMtime: undefined, baseSize: undefined,
        draft: '', dirty: false, editing: false, saving: false, justSaved: false,
        saveError: '', conflict: false,
      }
      // FIFO：最多同时 5 个预览，新开的挤掉最早打开的
      var list = getState().files.list.slice()
      while (list.length >= FILES_MAX_OPEN) list.shift()
      list.push(entry)
      setFiles({ list: list, active: path })
    } else if (entry.loaded) {
      setFiles({ active: path })
      if (activateFilesView()) return
      setFiles({ overlay: true, overlayMax: false, overlayReturn: null })
      return
    } else {
      setFiles({ active: path })
    }
    if (!activateFilesView()) setFiles({ overlay: true, overlayMax: false, overlayReturn: null })
    var res = await rpc('read', { path: path, sessionId: getActiveSessionId() })
    if (!res.ok && /超出允许范围/.test(res.error || '')) {
      await new Promise(function (r) { setTimeout(r, 600) })
      res = await rpc('read', { path: path, sessionId: getActiveSessionId() })
    }
    var cur = findFileEntry(path)
    if (!cur) return
    cur.loading = false
    if (!res || !res.ok) {
      cur.error = (res && res.error) || T('explorer.readFail')
    } else {
      cur.error = ''
      cur.loaded = true
      cur.kind = res.kind
      cur.size = res.size || 0
      if (res.kind === 'text') {
        cur.truncated = !!res.truncated
        if (!cur.dirty && !cur.editing) {
          cur.content = res.content
          cur.baseContent = res.content
          cur.draft = res.content
          cur.baseMtime = res.mtime
          cur.baseSize = res.size
        } else {
          cur.conflict = true
          cur.diskMtime = res.mtime
          cur.diskSize = res.size
          scheduleAutoSave(path)
        }
      }
      else if (res.kind === 'image') { cur.dataUrl = 'data:' + res.mime + ';base64,' + res.data }
      else if (res.kind === 'pdf') { cur.data = res.data }
    }
    setFiles({ list: getState().files.list.slice(), active: path })
  }

  /**
   * file 地址 → dsh-soup 预览（官方产物链接桥接入口）。session 作用域的
   * 路径相对会话 cwd，必须先解析成绝对路径再读——宿主 read 对相对路径按
   * 服务进程 cwd（桌面端为 launch-root）解析，直接透传会 ENOENT。
   */
  async function openFileAddressInSoup(address, sessionIdHint) {
    var parsed = parseFileAddress(address)
    if (!parsed) return false
    var sid = sessionIdHint || parsed.sessionId
    if (parsed.scope === 'session' && sid !== getActiveSessionId()) return false
    var target = parsed.path
    if (parsed.scope === 'session' && target.charAt(0) !== '/') {
      var cwd = getState().cwd || await defaultCwd(parsed.sessionId)
      if (cwd) target = String(cwd).replace(/\/+$/, '') + '/' + target
    }
    openFileInTab(target)
    return true
  }

  async function reloadFile(path) {
    var entry = findFileEntry(path)
    if (!entry) return
    // 复位 loaded，让 openFileInTab 走重读路径而不是「已打开直接激活」。
    entry.loaded = false
    await openFileInTab(path)
  }

  function startEditing(path) {
    var entry = findFileEntry(path)
    if (!entry || !entry.loaded || entry.kind !== 'text') return
    if (!isEditableTextFile(path)) {
      entry.saveError = T('files.notEditable')
      setFiles({ list: getState().files.list.slice() })
      return
    }
    if (entry.truncated) {
      entry.saveError = T('files.truncatedEdit')
      setFiles({ list: getState().files.list.slice() })
      return
    }
    if (!entry.editing) {
      entry.draft = entry.dirty ? entry.draft : entry.content
      entry.editing = true
    }
    entry.saveError = ''
    setFiles({ list: getState().files.list.slice() })
  }

  function scheduleAutoSave(path) {
    clearTimeout(autoSaveTimers.get(path))
    autoSaveTimers.set(path, setTimeout(function () {
      autoSaveTimers.delete(path)
      saveActiveFile(path)
    }, AUTO_SAVE_DELAY_MS))
  }

  function showSavedIndicator(path) {
    clearTimeout(autoSaveSavedTimers.get(path))
    autoSaveSavedTimers.set(path, setTimeout(function () {
      autoSaveSavedTimers.delete(path)
      var entry = findFileEntry(path)
      if (!entry || entry.saving || entry.dirty) return
      entry.justSaved = false
      setFiles({ list: getState().files.list.slice() })
    }, SAVED_INDICATOR_MS))
  }

  function manuallySaveFile(path) {
    manualSavePaths.add(path)
    saveActiveFile(path)
  }

  function stopEditing(path) {
    var entry = findFileEntry(path)
    if (!entry || !entry.editing) return
    clearTimeout(autoSaveTimers.get(path))
    autoSaveTimers.delete(path)
    clearTimeout(autoSaveSavedTimers.get(path))
    autoSaveSavedTimers.delete(path)
    if (entry.dirty) {
      if (entry.saving) entry.saveOnExit = true
      else saveActiveFile(path)
    }
    entry.editing = false
    setFiles({ list: getState().files.list.slice() })
  }

  function updateDraft(path, value) {
    var entry = findFileEntry(path)
    if (!entry || !entry.editing) return
    entry.draft = value
    entry.dirty = value !== entry.baseContent
    setFiles({ list: getState().files.list.slice() })
    scheduleAutoSave(path)
  }

  async function saveActiveFile(path) {
    var entry = findFileEntry(path)
    if (!entry || (!entry.editing && !entry.saveOnExit) || entry.saving || entry.truncated) return
    if (!entry.dirty) return
    entry.saving = true
    entry.saveError = ''
    setFiles({ list: getState().files.list.slice() })
    if (entry.conflict) {
      entry.baseMtime = entry.diskMtime
      entry.baseSize = entry.diskSize
      entry.conflict = false
    }
    var savedDraft = entry.draft
    var wasManualSave = manualSavePaths.has(path)
    manualSavePaths.delete(path)
    var res = await rpc('write', {
      path: path,
      content: entry.draft,
      expectedMtime: entry.baseMtime,
      expectedSize: entry.baseSize,
      sessionId: getActiveSessionId(),
    })
    var cur = findFileEntry(path)
    if (!cur) return
    cur.saving = false
    if (!res || !res.ok) {
      cur.saveError = (res && res.error) || T('files.saveTitle')
      if (res && res.conflict) {
        cur.conflict = true
        cur.diskMtime = res.mtime
        cur.diskSize = res.size
      }
      if (cur.editing || cur.saveOnExit) scheduleAutoSave(path)
      setFiles({ list: getState().files.list.slice() })
      return
    }
    cur.content = savedDraft
    cur.baseContent = savedDraft
    cur.dirty = cur.draft !== savedDraft
    if (!cur.dirty) cur.saveOnExit = false
    else if (cur.editing || cur.saveOnExit) scheduleAutoSave(path)
    cur.conflict = false
    cur.saveError = ''
    cur.justSaved = wasManualSave
    cur.size = res.size
    cur.baseMtime = res.mtime
    cur.baseSize = res.size
    setFiles({ list: getState().files.list.slice() })
    refresh()
    if (wasManualSave) showSavedIndicator(path)
  }

  function closeFileTab(path) {
    var list = getState().files.list
    var idx = -1
    for (var i = 0; i < list.length; i++) if (list[i].path === path) { idx = i; break }
    if (idx < 0) return
    clearTimeout(autoSaveTimers.get(path))
    autoSaveTimers.delete(path)
    clearTimeout(autoSaveSavedTimers.get(path))
    autoSaveSavedTimers.delete(path)
    var closing = list[idx]
    if (closing.dirty && typeof window !== 'undefined' && !window.confirm(T('files.unsavedConfirm'))) return
    var next = list.slice(0, idx).concat(list.slice(idx + 1))
    var active = getState().files.active
    if (active === path) {
      var neighbor = next[Math.min(idx, next.length - 1)]
      active = neighbor ? neighbor.path : null
    }
    setFiles({ list: next, active: active })
  }

  function setActiveFile(path) {
    setFiles({ active: path })
  }

  return {
    withinScope: withinScope,
    pruneFilesToScope: pruneFilesToScope,
    setFiles: setFiles,
    askOverwrite: askOverwrite,
    findFileEntry: findFileEntry,
    activateFilesView: activateFilesView,
    openFileInTab: openFileInTab,
    openFileAddressInSoup: openFileAddressInSoup,
    reloadFile: reloadFile,
    startEditing: startEditing,
    scheduleAutoSave: scheduleAutoSave,
    showSavedIndicator: showSavedIndicator,
    manuallySaveFile: manuallySaveFile,
    stopEditing: stopEditing,
    updateDraft: updateDraft,
    saveActiveFile: saveActiveFile,
    closeFileTab: closeFileTab,
    setActiveFile: setActiveFile,
  }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_FILES_STORE__ = { createFilesStore }
