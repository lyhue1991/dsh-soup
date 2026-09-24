/**
 * 速度徽标组件（区域三 · 🧂 盐）：会话标题旁的实时 t/s 吞吐徽标。
 *
 * 挂载点：slots 槽位 conversation.session.header.actions（与官方 Agent
 * 预设标签同槽，order 更大排在其后），React 状态驱动渲染，无 DOM 注入、
 * 无 MutationObserver——不受消息流内部结构与文案变动影响。
 * timerRef 由 apply 生命周期赋值，经 getTimerRef 包装函数取当前值。
 */

/** 创建 SpeedBadge 组件。
 * @param {object} ctx - { React, T, rpc, getTimerRef }。
 */
export function createSpeedBadge({ React, T, rpc, getTimerRef }) {
  var create = React.createElement

  function SpeedBadge(props) {
    // Hook 一律无条件调用（条件调用会在重渲染时打破 hook 链，
    // 触发宿主 React 内部 RangeError 并让整个槽位条目崩溃卸载）。
    var sessionId = props && props.sessionId
    var useSessions = props && props.useSessions
    var fallbackId = useSessions ? useSessions(function (list) {
      var ids = list && list.ids
      return ids && ids.length === 1 ? ids[0] : undefined
    }) : undefined
    if (!sessionId) sessionId = fallbackId

    var st = React.useState(function () { return { phase: 'idle' } })
    var status = st[0]
    var setStatus = st[1]
    var dt = React.useState(function () { return { dots: 1 } })
    var dots = dt[0].dots
    var setDots = dt[1]

    // 省略号循环（仅 waiting 阶段有视觉意义）
    React.useEffect(function () {
      var timerRef = getTimerRef()
      if (!timerRef) return
      var stop = timerRef.interval(function () {
        setDots(function (prev) { return prev >= 3 ? 1 : prev + 1 })
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
          if (!cancelled && res && res.ok) setStatus(res)
        }).catch(function () {})
      }
      poll()
      var stop = timerRef.interval(poll, 300)
      return function () { cancelled = true; stop() }
    }, [sessionId])

    // idle/done 不渲染任何可见内容；保留隐藏占位便于 e2e 验证挂载。
    if (!status || status.phase === 'idle' || status.phase === 'done') {
      return create('span', { className: 'dsh-soup-speed', style: { display: 'none' }, 'data-phase': 'idle' })
    }

    if (status.phase === 'waiting') {
      return create('span', {
        className: 'dsh-soup-speed',
        style: {
          display: 'inline-flex', alignItems: 'center',
          fontSize: '12px', fontWeight: 400,
          color: 'var(--dsw-alias-label-caption)',
          whiteSpace: 'nowrap',
        },
      }, T('speed.waiting') + '...'.slice(0, dots))
    }

    // 流式阶段：token 计数立即显示；瞬时速率窗口未满（tps=0）时先不显示
    // 速率药丸，而不是回退到等待文案（否则短输出全程都显示等待）。
    var tps = status.tps || 0
    var bg = tps >= 50 ? '#53b3cb' : tps >= 30 ? '#9bc53d' : tps >= 15 ? '#f9c22e' : '#e01a4f'
    var children = [
      create('span', {
        key: 'tok',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          color: 'var(--dsw-alias-label-caption)', fontSize: '11px',
        },
      },
        create('svg', {
          width: '10', height: '10', viewBox: '0 0 10 10', fill: 'none',
          stroke: 'currentColor', strokeWidth: '1.2',
          strokeLinecap: 'round', strokeLinejoin: 'round',
        },
          create('line', { x1: '5', y1: '1.5', x2: '5', y2: '8.5' }),
          create('polyline', { points: '2 6 5 8.5 8 6' }),
        ),
        String(Math.round(status.tokens || 0)),
      ),
    ]
    if (tps > 0) {
      children.push(create('span', {
        key: 'pill',
        style: {
          padding: '1px 6px', borderRadius: '4px',
          background: bg, color: '#fff',
          fontSize: '11px', fontWeight: 500,
        },
      }, tps.toFixed(1) + ' t/s'))
    }
    return create('span', {
      className: 'dsh-soup-speed',
      style: { display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' },
    }, children)
  }

  return SpeedBadge
}

if (typeof window !== 'undefined') window.__DSH_SOUP_SPEED_BADGE__ = { createSpeedBadge }
