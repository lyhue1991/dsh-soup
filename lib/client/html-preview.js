/**
 * HTML preview implementation.
 *
 * The parent plugin supplies the host RPC and React primitives, keeping this
 * module independent of the DSH module-loader registration mechanism.
 */
const ASSET_MAX_BYTES = 4 * 1024 * 1024
const TOTAL_MAX_BYTES = 32 * 1024 * 1024
const MAX_ASSETS = 64
const IMAGE_MAX_COUNT = 64
/** Same whitelist as the host inline-image route (host/file-view.js IMAGE_MIME). */
const IMAGE_DATA_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
}
const CSS_URL_RE = /url\(\s*('([^']*)'|"([^"]*)"|([^)'"]*))\s*\)/gi

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

function imageMimeOf(reference) {
  const match = /\.([A-Za-z0-9]+)$/.exec(assetPath(reference))
  return match ? IMAGE_DATA_MIME[match[1].toLowerCase()] : undefined
}

function relativeKey(reference) {
  const out = []
  for (const segment of String(reference || '').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
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

  // ------------------------------------------------------------------
  // 相对路径图片内联为 data URL。srcdoc iframe 的文档 base URL 继承宿主
  // 应用页面，`article_files/img.jpg` 之类的相对 <img> 会被解析到应用自身
  // 路由而 404；且沙箱（无 allow-same-origin）发出的子资源请求 Origin 为
  // opaque，无法走 /api/dsh-soup/img 的同源校验。因此与 script/css 同路：
  // 经 read-related（限定文档目录内）读出后内联，彻底不依赖网络解析。
  // ------------------------------------------------------------------
  const imageCache = new Map()
  function loadImage(reference) {
    let bare = assetPath(reference)
    try { bare = decodeURIComponent(bare) } catch { /* keep raw path */ }
    if (!imageMimeOf(bare)) return Promise.resolve(null)
    const key = relativeKey(bare)
    let entry = imageCache.get(key)
    if (!entry) {
      if (imageCache.size >= IMAGE_MAX_COUNT) return Promise.resolve(null)
      entry = Promise.resolve(rpc('read-related', { path: rootPath, relativePath: bare, sessionId }))
        .then((response) => {
          if (!response?.ok || response.size > ASSET_MAX_BYTES) return null
          const bytes = Math.ceil(response.data.length * 3 / 4)
          if (total + bytes > TOTAL_MAX_BYTES) return null
          total += bytes
          return { url: 'data:' + imageMimeOf(bare) + ';base64,' + response.data, bytes }
        })
        .catch(() => null)
      imageCache.set(key, entry)
    }
    return entry
  }

  let mutated = false
  await Promise.all(
    Array.from(template.content.querySelectorAll('img[src],source[src],video[poster],input[type="image"][src]'))
      .map(async (element) => {
        const attribute = element.localName === 'video' ? 'poster' : 'src'
        const reference = element.getAttribute(attribute) || ''
        if (!relativeReference(reference) || !imageMimeOf(reference)) return
        signal.throwIfAborted?.()
        const image = await loadImage(reference)
        if (image) { element.setAttribute(attribute, image.url); mutated = true }
      }),
  )

  // 响应式图片：srcset 是「url 描述符, url 描述符」列表，逐候选改写。
  for (const element of template.content.querySelectorAll('img[srcset],source[srcset]')) {
    signal.throwIfAborted?.()
    const value = element.getAttribute('srcset') || ''
    if (!value) continue
    const parts = await Promise.all(value.split(',').map(async (part) => {
      const trimmed = part.trim()
      if (!trimmed) return part
      const cut = trimmed.search(/\s/)
      const url = cut === -1 ? trimmed : trimmed.slice(0, cut)
      const rest = cut === -1 ? '' : trimmed.slice(cut)
      if (!relativeReference(url)) return part
      const image = await loadImage(url)
      return image ? image.url + rest : part
    }))
    const next = parts.join(',')
    if (next !== value) { element.setAttribute('srcset', next); mutated = true }
  }

  // 内联 <style> 与 style 属性里的相对 url(...) 背景图（仅图片扩展名）。
  async function rewriteCssUrls(text) {
    if (!text || String(text).indexOf('url(') === -1) return text
    const refs = new Set()
    for (const match of String(text).matchAll(CSS_URL_RE)) {
      const raw = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4]
      const reference = String(raw || '').trim()
      if (reference && relativeReference(reference) && imageMimeOf(reference)) refs.add(reference)
    }
    if (!refs.size) return text
    const resolved = new Map()
    for (const reference of refs) {
      const image = await loadImage(reference)
      if (image) resolved.set(reference, image.url)
    }
    if (!resolved.size) return text
    return String(text).replace(CSS_URL_RE, (match, quote, single, double, bare) => {
      const url = resolved.get(String(single !== undefined ? single : double !== undefined ? double : bare).trim())
      return url ? 'url(' + url + ')' : match
    })
  }
  for (const element of template.content.querySelectorAll('style')) {
    signal.throwIfAborted?.()
    const next = await rewriteCssUrls(element.textContent)
    if (next !== element.textContent) { element.textContent = next; mutated = true }
  }
  for (const element of template.content.querySelectorAll('[style]')) {
    signal.throwIfAborted?.()
    const next = await rewriteCssUrls(element.getAttribute('style'))
    if (next !== element.getAttribute('style')) { element.setAttribute('style', next); mutated = true }
  }

  // 图片已直接写入模板；仅在发生内联时回传序列化结果，
  // 纯外链文档保持原始 srcDoc 上下文不变。
  return { html: mutated ? template.innerHTML : source, assets }
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
