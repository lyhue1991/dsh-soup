/**
 * 多行 GoalBar（区域四 · 🧄 蒜）：复用原生 goal projection 与动作动词，
 * 多行完整展示 + textarea 编辑。
 *
 * 通过 conversation.input.dock 同 id 'goal' + 更低 priority (-1 < 0)
 * 遮蔽默认实现，不改 DSH 源码，工具与数据仍走原生 goal。
 */

/** 创建 GoalBar / GoalDock 组件。
 * @param {object} ctx - { React, create, T }。
 */
export function createGoalBar({ React, create, T }) {
  var GOAL_PHASE_LABELS = {
    active: 'phase.active',
    paused: 'phase.paused',
    blocked: 'phase.blocked',
  }

  function goalIcon(children) {
    return create('svg', {
      width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      strokeLinejoin: 'round', 'aria-hidden': true,
    }, children)
  }

  var ICON_GOAL = goalIcon([
    create('circle', { key: 'a', cx: '12', cy: '12', r: '10' }),
    create('circle', { key: 'b', cx: '12', cy: '12', r: '6' }),
    create('circle', { key: 'c', cx: '12', cy: '12', r: '2', fill: 'currentColor', stroke: 'none' }),
  ])
  var ICON_PAUSE = goalIcon([
    create('rect', { key: 'a', x: '6', y: '4', width: '4', height: '16', rx: '1', fill: 'currentColor', stroke: 'none' }),
    create('rect', { key: 'b', x: '14', y: '4', width: '4', height: '16', rx: '1', fill: 'currentColor', stroke: 'none' }),
  ])
  var ICON_PLAY = goalIcon([
    create('path', { key: 'p', d: 'M6 4l14 8-14 8V4z', fill: 'currentColor', stroke: 'none' }),
  ])
  var ICON_EDIT = goalIcon([
    create('path', { key: 'a', d: 'M12 20h9' }),
    create('path', { key: 'b', d: 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' }),
  ])
  var ICON_CHECK = goalIcon([
    create('polyline', { key: 'a', points: '20 6 9 17 4 12' }),
  ])
  var ICON_CLOSE = goalIcon([
    create('line', { key: 'a', x1: '18', y1: '6', x2: '6', y2: '18' }),
    create('line', { key: 'b', x1: '6', y1: '6', x2: '18', y2: '18' }),
  ])
  var ICON_TRASH = goalIcon([
    create('polyline', { key: 'a', points: '3 6 5 6 21 6' }),
    create('path', { key: 'b', d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6' }),
    create('path', { key: 'c', d: 'M10 11v6' }),
    create('path', { key: 'd', d: 'M14 11v6' }),
    create('path', { key: 'e', d: 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }),
  ])

  function GoalBar(props) {
    var goal = props.goal
    var roundsStarted = props.roundsStarted
    var onEdit = props.onEdit
    var onPause = props.onPause
    var onResume = props.onResume
    var onClear = props.onClear
    var t = props.t || function (k) { return k }

    var editing = React.useState(false)
    var draft = React.useState('')
    var pending = React.useState(false)
    var actionError = React.useState(null)
    var clearedGoalId = React.useState(null)
    var pendingRef = React.useRef(false)
    var textareaRef = React.useRef(null)

    var goalId = goal ? goal.id : undefined
    React.useEffect(function () {
      editing[1](false)
      actionError[1](null)
      clearedGoalId[1](null)
    }, [goalId])

    React.useEffect(function () {
      var input = textareaRef.current
      if (!input) return
      input.style.height = 'auto'
      input.style.height = Math.max(64, input.scrollHeight) + 'px'
    }, [draft[0], editing[0]])

    function runAction(action) {
      if (pendingRef.current) return Promise.resolve(undefined)
      pendingRef.current = true
      pending[1](true)
      actionError[1](null)
      return Promise.resolve().then(function () { return action() }).then(function (result) {
        pendingRef.current = false
        pending[1](false)
        if (!result || !result.ok) {
          var err = result && result.error ? (result.error.message + ' (' + result.error.code + ')') : T('speed.operateFail')
          actionError[1](err)
        }
        return result
      }).catch(function (e) {
        pendingRef.current = false
        pending[1](false)
        actionError[1](String((e && e.message) || e))
      })
    }

    function handleSave() {
      var trimmed = draft[0].trim()
      if (trimmed === '') return
      runAction(function () { return onEdit(trimmed) }).then(function (result) {
        if (result && result.ok) {
          editing[1](false)
        }
      })
    }

    function handleClear() {
      if (!goal) return
      var clearedId = goal.id
      runAction(onClear).then(function (result) {
        if (result && result.ok) clearedGoalId[1](clearedId)
      })
    }

    function openEdit() {
      if (!goal) return
      draft[1](goal.objective)
      editing[1](true)
    }

    function iconBtn(label, onClick, iconNode, disabled) {
      return create('button', {
        type: 'button', title: label, 'aria-label': label,
        className: 'dsh-goal-btn', disabled: disabled === true || pending[0],
        onClick: function () { void onClick() },
      }, iconNode)
    }

    if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === clearedGoalId[0]) return null

    if (editing[0]) {
      return create('div', { className: 'dsh-goal-dock', 'data-goal-bar': '' },
        create('div', { className: 'dsh-goal-bar' },
          create('div', { className: 'dsh-goal-head' },
            create('span', { className: 'dsh-goal-glyph' }, ICON_GOAL),
            create('span', { className: 'dsh-goal-label' }, t(GOAL_PHASE_LABELS[goal.phase] || 'phase.active')),
            actionError[0] !== null && create('span', { className: 'dsh-goal-error', role: 'alert' }, actionError[0]),
            create('div', { className: 'dsh-goal-actions' },
              iconBtn(t('action.save'), handleSave, ICON_CHECK, draft[0].trim() === ''),
              iconBtn(t('action.cancel'), function () { editing[1](false) }, ICON_CLOSE),
            ),
          ),
          create('textarea', {
            className: 'dsh-goal-input',
            ref: textareaRef,
            'aria-label': t('objective.aria'),
            value: draft[0],
            autoFocus: true,
            onChange: function (e) { draft[1](e.target.value) },
            onKeyDown: function (e) {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSave() }
              else if (e.key === 'Escape') { e.preventDefault(); editing[1](false) }
            },
          }),
        ),
      )
    }

    var title = goal.phase === 'blocked' && goal.blockedReason ? goal.blockedReason.message : undefined
    var rounds = roundsStarted !== undefined && goal.maxGoalRounds !== undefined
      ? roundsStarted + '/' + goal.maxGoalRounds
      : undefined
    return create('div', { className: 'dsh-goal-dock', 'data-goal-bar': '' },
      create('div', { className: 'dsh-goal-bar', title: title || '' },
        create('div', { className: 'dsh-goal-head' },
            create('span', { className: 'dsh-goal-glyph' }, ICON_GOAL),
            create('span', { className: 'dsh-goal-label' }, t(GOAL_PHASE_LABELS[goal.phase] || 'phase.active')),
            rounds !== undefined && create('span', { className: 'dsh-goal-rounds' }, rounds),
          actionError[0] !== null && create('span', { className: 'dsh-goal-error', role: 'alert' }, actionError[0]),
          create('div', { className: 'dsh-goal-actions' },
            goal.phase === 'active' && iconBtn(t('action.pause'), function () { return runAction(onPause) }, ICON_PAUSE),
            goal.phase === 'paused' && iconBtn(t('action.resume'), function () { return runAction(onResume) }, ICON_PLAY),
            iconBtn(t('action.edit'), openEdit, ICON_EDIT),
            iconBtn(t('action.clear'), handleClear, ICON_TRASH),
          ),
        ),
        create('div', { className: 'dsh-goal-objective' }, goal.objective),
      ),
    )
  }

  function GoalDock(props) {
    var projection = props.useProjection('goal')
    var goal = projection === undefined ? undefined : projection === null ? null : projection.goal
    return create(GoalBar, {
      goal: goal,
      roundsStarted: projection === undefined || projection === null ? undefined : projection.roundsStarted,
      onEdit: props.onEdit,
      onPause: props.onPause,
      onResume: props.onResume,
      onClear: props.onClear,
      t: props.t,
    })
  }

  return { GoalBar: GoalBar, GoalDock: GoalDock }
}

if (typeof window !== 'undefined') window.__DSH_SOUP_GOAL_BAR__ = { createGoalBar }

