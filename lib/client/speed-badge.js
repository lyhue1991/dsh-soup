/**
 * 速度徽标组件（区域三 · 🧂 盐）：Deep diving 行内的实时 t/s 吞吐徽标。
 *
 * 不改 DSH 源码：MutationObserver 定位消息流里的 Deep diving（role=status），
 * 把徽标节点 append 进其行内（inline-flex 同行），实现永远紧贴。
 * timerRef 由 apply 生命周期赋值，经 getTimerRef 包装函数取当前值。
 */

/** 创建 SpeedBadge 组件。
 * @param {object} ctx - { React, T, rpc, getTimerRef }。
 */
export function createSpeedBadge({ React, T, rpc, getTimerRef }) {
  function SpeedBadge(props) {
    var sessionId = props && (props.sessionId || (props.session && (props.session.sessionId || props.session.id)))

    // 持有最新状态的最新值的 ref（供 MutationObserver 回调读取）
    var statusRef = React.useRef(null)
    var dotsRef = React.useRef(1)
    var badgeElRef = React.useRef(null)
    // hostRef：当前挂载的 Deep diving 宿主元素（observer 找到后持有）
    var hostRef = React.useRef(null)

    // 省略号循环
    React.useEffect(function () {
      var timerRef = getTimerRef()
      if (!timerRef) return
      var stop = timerRef.interval(function () {
        dotsRef.current = dotsRef.current >= 3 ? 1 : dotsRef.current + 1
        if (hostRef.current) renderBadge()
      }, 400)
      return function () { stop() }
    }, [])

    // 速度轮询
    React.useEffect(function () {
      if (!sessionId) return
      var timerRef = getTimerRef()
      if (!timerRef) return
      var cancelled = false
      var poll = function () {
        rpc('speed-status', { sessionId: sessionId }).then(function (res) {
          if (!cancelled && res && res.ok) {
            statusRef.current = res
            if (hostRef.current) renderBadge()
          }
        }).catch(function () {})
      }
      poll()
      var stop = timerRef.interval(poll, 300)
      return function () { cancelled = true; stop() }
    }, [sessionId])

    // 渲染徽标内容到 badgeEl（由需要时调用；这里用函数声明提升，需放在 effect 外）
    function renderBadge() {
      var el = badgeElRef.current
      if (!el) return
      var st = statusRef.current
      // 清空
      while (el.firstChild) el.removeChild(el.firstChild)
      if (!st || st.phase === 'idle' || st.phase === 'done') {
        el.style.display = 'none'
        return
      }
      el.style.display = 'inline-flex'
      if (st.phase === 'waiting') {
        // 宿主 .turnStatus 用 background-clip:text + 渐变透明色，内部子元素
        // 会继承 text-fill-color 而把颜色冲成渐变；必须 important 覆盖。
        el.style.cssText = 'display:inline-flex;align-items:center;margin-left:10px;font-weight:400;font-size:13px;color:var(--dsw-alias-label-caption);'
        el.style.setProperty('color', 'var(--dsw-alias-label-caption)', 'important')
        el.style.setProperty('-webkit-text-fill-color', 'var(--dsw-alias-label-caption)', 'important')
        el.textContent = T('speed.waiting') + new Array(dotsRef.current + 1).join('.')
        return
      }
      // 流式阶段：token 计数立即显示；瞬时速率窗口未满（tps=0）时先不显示徽标，
      // 而不是回退到「正在等待模型」（否则短输出全程都显示等待）。
      var tps = st.tps || 0
      var bg = tps >= 50 ? '#53b3cb' : tps >= 30 ? '#9bc53d' : tps >= 15 ? '#f9c22e' : '#e01a4f'
      el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:10px;font-weight:400;font-size:11px;color:var(--dsw-alias-label-primary);-webkit-text-fill-color:var(--dsw-alias-label-primary);'
      var tok = document.createElement('span')
      tok.style.cssText = 'display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-caption);-webkit-text-fill-color:var(--dsw-alias-label-caption);'
      var SVG = 'http://www.w3.org/2000/svg'
      var svg = document.createElementNS(SVG, 'svg')
      svg.setAttribute('width', '10'); svg.setAttribute('height', '10'); svg.setAttribute('viewBox', '0 0 10 10')
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.2')
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
      var ln = document.createElementNS(SVG, 'line'); ln.setAttribute('x1', '5'); ln.setAttribute('y1', '1.5'); ln.setAttribute('x2', '5'); ln.setAttribute('y2', '8.5'); svg.appendChild(ln)
      var poly = document.createElementNS(SVG, 'polyline'); poly.setAttribute('points', '2 6 5 8.5 8 6'); svg.appendChild(poly)
      tok.appendChild(svg)
      tok.appendChild(document.createTextNode(String(Math.round(st.tokens))))
      el.appendChild(tok)
      if (tps > 0) {
        var pill = document.createElement('span')
        pill.style.cssText = 'margin-left:6px;padding:1px 6px;border-radius:4px;background:' + bg + ';color:#fff;-webkit-text-fill-color:#fff;font-size:11px;font-weight:500;'
        pill.textContent = tps.toFixed(1) + ' t/s'
        el.appendChild(pill)
      }
    }

    // MutationObserver：定位 Deep diving 并把 badgeEl 挂进去
    React.useEffect(function () {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
      // 初始化徽标 DOM 节点
      if (badgeElRef.current === null) {
        badgeElRef.current = document.createElement('span')
        badgeElRef.current.setAttribute('data-dsh-speed-badge', '')
        badgeElRef.current.style.display = 'none'
      }
      var badge = badgeElRef.current

      function findTurnStatus() {
        var candidates = document.querySelectorAll('[data-chat-flow] [role="status"], [data-chat-flow] [aria-live="polite"]')
        for (var i = 0; i < candidates.length; i++) {
          var text = candidates[i].textContent || ''
          // DSH i18n（locale chat.deepDiving）：英文 'Deep diving...' / 中文 '深度求索中...'
          if (text.indexOf('Deep diving') !== -1 || text.indexOf('深度求索') !== -1) return candidates[i]
        }
        return null
      }

      function attach() {
        // 已挂载且宿主仍在 DOM 中时无需重复查找：徽标内容由 timer/poll 驱动
        // renderBadge 更新，observer 只负责把徽标挂进/移出宿主元素。
        if (hostRef.current && hostRef.current.isConnected) {
          // 若 DSH 在徽标之后又追加了子元素（如 15s 后的 elapsed clock），
          // 把徽标移到末尾，让它始终紧跟 Deep diving 的计时。
          if (badge.parentNode !== hostRef.current || hostRef.current.lastElementChild !== badge) {
            try { hostRef.current.appendChild(badge) } catch (e) {}
          }
          return
        }
        var target = findTurnStatus()
        if (target !== null) {
          hostRef.current = target
          if (badge.parentNode !== target) { try { target.appendChild(badge) } catch (e) {} }
          renderBadge()
        } else if (hostRef.current !== null) {
          if (badge.parentNode) { try { badge.parentNode.removeChild(badge) } catch (e) {} }
          hostRef.current = null
        }
      }

      var mo = new MutationObserver(function () { attach() })
      mo.observe(document.body, { childList: true, subtree: true })
      attach()
      return function () {
        mo.disconnect()
        if (badge.parentNode) { try { badge.parentNode.removeChild(badge) } catch (e) {} }
        hostRef.current = null
      }
    }, [])

    return null
  }

  return SpeedBadge
}

if (typeof window !== 'undefined') window.__DSH_SOUP_SPEED_BADGE__ = { createSpeedBadge }

