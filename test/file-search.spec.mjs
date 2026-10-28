import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('file search wires CodeMirror and preview DOM search', () => {
  const pkg = JSON.parse(read('package.json'))
  if (!pkg.dependencies || !pkg.dependencies['@codemirror/search']) {
    throw new Error('@codemirror/search must be a declared dependency')
  }

  const modules = read('lib/codemirror-modules.js')
  if (!modules.includes("import * as search from '@codemirror/search'") || !modules.includes("'@codemirror/search': search")) {
    throw new Error('@codemirror/search must be registered through the module bridge')
  }

  const main = read('lib/client.main.js')
  const renderers = read('lib/client/preview-renderers.js')
  const filesView = read('lib/client/files-view.js')
  const styles = read('lib/client/styles.js')
  const bundle = read('lib/client.js')

  if (!main.includes("require('@codemirror/search')") || !main.includes('Search: CMSearch')) {
    throw new Error('the host-side client assembly must inject the CodeMirror search module')
  }
  if (!renderers.includes('CMSearch.search({ top: true })') || !renderers.includes('CMSearch.searchKeymap') || !renderers.includes('CMSearch.openSearchPanel')) {
    throw new Error('CodeMirror editors must use the official search extension and commands')
  }
  if (!renderers.includes('function openEditorSearch') || !renderers.includes('editorViews.set(entry.path, viewRef.current)')) {
    throw new Error('container Cmd/Ctrl+F must be forwarded to the active CodeMirror view')
  }
  if (!filesView.includes('className: \'dfv-searchbar\'') || !filesView.includes('function findTextRanges')) {
    throw new Error('preview mode must provide a search overlay and DOM text search')
  }
  if (!filesView.includes("e.key === 'f' || e.key === 'F' || e.code === 'KeyF'")) {
    throw new Error('preview mode must handle both Cmd+F and Ctrl+F')
  }
  if (!filesView.includes("e.key === 'F3'") || !filesView.includes('dsh-soup-search-current')) {
    throw new Error('preview search must support next/previous navigation and a distinct current match')
  }
  if (filesView.includes("e.key === 'Tab'")) {
    throw new Error('preview search must keep Tab as normal focus navigation')
  }
  if (filesView.includes('selection.addRange(range)') || !filesView.includes('searchInputHadFocus')) {
    throw new Error('preview search must not move document focus away from the search input')
  }
  if (filesView.includes("scrollIntoView({ behavior: 'smooth', block: 'center' })") || !filesView.includes('getComputedStyle') || !filesView.includes('scrollHeight > node.clientHeight')) {
    throw new Error('preview search must scroll only the actual inner content scroller')
  }
  if (!styles.includes('::highlight(dsh-soup-search)') || !styles.includes('::highlight(dsh-soup-search-current)') || !styles.includes('.dfv-cm-editor .cm-panel.cm-search') || !styles.includes('.dfv-cm-editor .cm-editor>.cm-panels{position:fixed;')) {
    throw new Error('search highlights and CodeMirror search panel must be styled')
  }
  if (!renderers.includes('panel.style.position = \'fixed\'') || !renderers.includes("window.addEventListener('scroll', positionSearchPanel, true)")) {
    throw new Error('editor search panel must stay anchored while the preview scrolls')
  }
  if (!styles.includes('.dfv-root{') || !styles.includes('overflow:hidden;background:var(--dsw-specific-sidebar-fill)') || !styles.includes('.dfv-searchbar{position:fixed;')) {
    throw new Error('preview search must stay in a viewport floating layer while content scrolls')
  }
  if (!filesView.includes('getBoundingClientRect()') || !filesView.includes("window.addEventListener('scroll', onScroll, true)")) {
    throw new Error('floating preview search must follow the preview panel while outer containers scroll')
  }
  if (!filesView.includes('(!isOverlay && files.overlay)') || !filesView.includes('isOverlay: true')) {
    throw new Error('only the visible preview surface may own the floating search overlay')
  }
  if (!bundle.includes('openSearchPanel') || !bundle.includes('dfv-searchbar')) {
    throw new Error('the browser bundle must contain editor and preview search implementations')
  }
})
