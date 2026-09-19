/**
 * HTML preview implementation.
 *
 * The parent plugin supplies the host RPC and React primitives, keeping this
 * module independent of the DSH module-loader registration mechanism.
 */
const ASSET_MAX_BYTES = 4 * 1024 * 1024
const TOTAL_MAX_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64

function base64ToText(data) {
  const raw = atob(data)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function relativeReference(reference) {
  return Boolean(reference)
    && !/^(?:[a-z][a-z\d+.-]*:|[/\\#?])/i.test(reference)
    && !reference.includes('\0')
    && !reference.includes('\\')
}

function assetPath(reference) {
  const cut = String(reference || '').search(/[?#]/)
  return cut === -1 ? String(reference || '') : String(reference || '').slice(0, cut)
}

/** Preserve legacy WeChat document compatibility in every rendering mode. */
export function prepareHtmlText(text) {
  let next = String(text || '')
  if (next.includes('js_content') || next.includes('data-src=')) {
    const inject = '<style>#js_content{visibility:visible!important;opacity:1!important;}</style>'
    next = /<\/head>/i.test(next) ? next.replace(/<\/head>/i, inject + '</head>') : inject + next
    next = next.replace(/(<img\b[^>]*?)\sdata-src=/gi, '$1 src=')
  }
  return next
}

/** Inline loaded local dependencies to preserve classic-script ordering in Desktop WebView. */
export function inlinePackedHtml(bundle) {
  if (!bundle.assets.length) return bundle.html
  const template = document.createElement('template')
  template.innerHTML = bundle.html
  for (const asset of bundle.assets) {
    if (asset.kind === 'script') {
      for (const script of template.content.querySelectorAll('script[src]')) {
        if (script.getAttribute('src') !== asset.reference) continue
        script.removeAttribute('src')
        script.textContent = asset.text
      }
    } else {
      for (const link of template.content.querySelectorAll('link[rel~="stylesheet" i][href]')) {
        if (link.getAttribute('href') !== asset.reference) continue
        const style = document.createElement('style')
        style.textContent = asset.text
        link.replaceWith(style)
      }
    }
  }
  return '<!doctype html>' + template.innerHTML
}

export async function packHtmlPreview({ text, rootPath, sessionId, rpc, signal }) {
  const source = prepareHtmlText(text)
  const encoder = new TextEncoder()
  const rootBytes = encoder.encode(source).byteLength
  if (rootBytes > TOTAL_MAX_BYTES) throw new Error('HTML document exceeds 32 MB')

  const template = document.createElement('template')
  template.innerHTML = source
  if (template.content.querySelector('base[href]')) return { html: source, assets: [] }

  const assets = []
  const seen = new Set()
  let total = rootBytes
  for (const element of template.content.querySelectorAll('script[src],link[href]')) {
    signal.throwIfAborted?.()
    const script = element.localName === 'script'
    const type = (element.getAttribute('type') || '').trim().toLowerCase()
    if (script && type && type !== 'text/javascript' && type !== 'application/javascript') continue
    if (!script && !(element.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) continue
    const reference = element.getAttribute(script ? 'src' : 'href') || ''
    const bare = assetPath(reference)
    if (!relativeReference(reference) || !(script ? /\.js$/i : /\.css$/i).test(bare)) continue
    const kind = script ? 'script' : 'stylesheet'
    const key = kind + ':' + reference
    if (seen.has(key) || assets.length >= MAX_ASSETS) continue
    seen.add(key)
    const response = await rpc('read-related', { path: rootPath, relativePath: bare, sessionId })
    signal.throwIfAborted?.()
    // Best effort: a missing/malformed local dependency must not blank the HTML itself.
    if (!response?.ok || response.size > ASSET_MAX_BYTES) continue
    try {
      const assetText = base64ToText(response.data)
      const bytes = encoder.encode(assetText).byteLength
      if (total + bytes > TOTAL_MAX_BYTES) continue
      total += bytes
      assets.push({ kind, reference, text: assetText })
    } catch { /* malformed UTF-8 dependency is skipped */ }
  }
  return { html: source, assets }
}

/** Build the React component while retaining DSH runtime dependencies at the caller boundary. */
export function createHtmlPreview({ React, create, rpc, translate }) {
  return function HtmlPreview(props) {
    const [frame, setFrame] = React.useState({ key: null, source: null, ready: false })
    const key = String(props.path || '') + '\0' + String(props.text || '')
    React.useEffect(() => {
      const controller = new AbortController()
      setFrame({ key, source: null, ready: false })
      packHtmlPreview({ text: props.text, rootPath: props.path, sessionId: props.sessionId, rpc, signal: controller.signal })
        .then((bundle) => {
          if (!controller.signal.aborted) setFrame({ key, source: inlinePackedHtml(bundle), ready: true })
        })
        .catch(() => {
          if (!controller.signal.aborted) setFrame({ key, source: prepareHtmlText(props.text), ready: true })
        })
      return () => controller.abort()
    }, [key, props.path, props.sessionId])
    if (frame.key !== key || !frame.ready) return create('div', { className: 'dfv-muted' }, '正在加载 HTML 预览…')
    return create('iframe', {
      className: 'dfv-frame',
      sandbox: 'allow-scripts allow-popups allow-forms allow-modals',
      referrerPolicy: 'no-referrer',
      title: props.title || translate('files.htmlFrame'),
      srcDoc: frame.source,
      'data-html-preview-fallback': true,
    })
  }
}

// client.js is registered through DSH's non-ESM module loader. Keep the
// implementation authored as ESM, and expose only this small factory bridge.
if (typeof window !== 'undefined') {
  window.__DSH_SOUP_HTML_PREVIEW__ = { createHtmlPreview }
}
