/**
 * dsh-soup — 浏览器半区：项目资源管理器。
 *
 * 布局：注册进 shell 原生的 `details` 右列（并列网格，非悬浮），
 * 有 Session log 时在它右侧放 📁；空白新会话则在输入框上方、
 * workspace/preset 控件行的右端提供同一入口。
 * 宽度与左侧工作区一致：默认 280px、可拖 264–420px（直接改写 shell 网格
 * 的 details 轨，并用 MutationObserver 在 shell 重渲染后维持宽度）。
 *
 * 与宿主通信：走同源 HTTP 路由 `/api/dsh-soup`（POST JSON），
 * 即永久插件（profile bundle）规范桥梁，而非 dynamic 半区的 host.call。
 * 文件「预览」为只读展示：markdown/html/json/csv 有专属渲染器，图片预览，
 * 其余按纯文本；不提供编辑与保存。
 */
window.__ModuleLoader__.load({
  id: '@lyhue1991/dsh-soup',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var create = React.createElement

    // 可选依赖：DSH 自带的不可信 Markdown 渲染器（micromark 管线，与聊天
    // 消息同款；不安全协议与相对链接被禁用）与 Shiki 代码高亮块（CodeBlock，
    // 懒加载语法包 + 复制按钮）。旧版宿主缺该模块时回退纯文本预览。
    // 注意：export 是 React.memo() 的产物——是 exotic 组件对象而非 function，
    // 判断只能验真值，不能 typeof==='function'。
    var MarkdownText = null
    var CodeBlock = null
    try {
      var uiPrim = require('@deepseek-ai/dsh-client-ui-primitives')
      var cand = uiPrim && uiPrim.MarkdownText
      if (cand) MarkdownText = cand
      else {
        try { window.__DSH_TREE_REQ_ERR = 'seed missing MarkdownText; type=' + typeof cand } catch (_) {}
      }
      var candBlock = uiPrim && uiPrim.CodeBlock
      if (candBlock) CodeBlock = candBlock
    } catch (err) {
      try { window.__DSH_TREE_REQ_ERR = 'require threw: ' + String((err && err.message) || err) } catch (_) {}
    }

    // ------------------------------------------------------------------
    // 样式：一次性注入 <style data-plugin>（与官方插件 css 内联约定一致）
    // ------------------------------------------------------------------
    var EXPL_CSS = '.expl-panel{position:relative;height:100%;min-width:0;width:100%;display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family);overflow:hidden;box-sizing:border-box;}' +
      '.expl-resize{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:col-resize;z-index:6;touch-action:none;}' +
      '.expl-resize::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:3px;height:40px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover);opacity:0;transition:opacity .15s;}' +
      '.expl-resize:hover::after{opacity:1;}' +
      '[data-side="details"]{display:none!important;}' +
      '.expl-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-title{font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;font-size:14px;}' +
      '.expl-head-btns{display:flex;gap:2px;flex-wrap:nowrap;}' +
      '.expl-btn{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;border-radius:8px;flex:none;}' +
      '.expl-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.expl-btn svg{width:16px;height:16px;display:block;}' +
      '.expl-path{font-size:11px;color:var(--dsw-alias-label-secondary);padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;flex:none;cursor:default;}' +
      '.expl-error{color:var(--dsw-alias-state-error-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-notice{color:var(--dsw-alias-state-success-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-bulk{color:var(--dsw-alias-state-business-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-body{overflow:auto;flex:1;padding:6px 0 12px;}' +
      '.expl-row-main{display:flex;align-items:center;gap:6px;padding-top:2px;padding-bottom:2px;padding-right:10px;cursor:pointer;border-radius:8px;margin:0 4px;height:40px;box-sizing:border-box;user-select:none;}' +
      '.expl-row-main:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-row-main.selected{background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-row-main.drop-target,.expl-body.drop-target{outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:-2px;background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-caret{flex:none;cursor:pointer;line-height:1;}' +
      '.expl-caret-big{width:24px;font-size:33px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:flex-start;}' +
      '.expl-caret-sm{width:24px;font-size:33px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:flex-start;}' +
      '.expl-icon{flex:none;display:flex;align-items:center;}.expl-icon svg{width:16px;height:16px;display:block;}' +
      '.expl-uploads{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);padding:5px 14px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-specific-tip);}' +
      '.expl-upload-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);}' +
      '.expl-upload-done{color:var(--dsw-alias-state-success-primary);}' +
      '.expl-upload-pct{margin-left:auto;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-caption);}' +
      '.expl-upload-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.expl-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}' +
      '.expl-size{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;margin-left:8px;}' +
      '.expl-muted{color:var(--dsw-alias-label-tertiary);padding:4px 14px;font-size:12px;}' +
      '.expl-menu-mask{position:fixed;inset:0;z-index:1980;}' +
      '.expl-menu{position:fixed;z-index:1990;min-width:172px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;padding:4px;box-shadow:var(--dsw-shadow-lv3);pointer-events:auto;}' +
      '.expl-menu-item{display:block;width:100%;text-align:left;background:transparent;border:none;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 10px;border-radius:8px;cursor:pointer;line-height:1.4;}' +
      '.expl-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-danger{color:var(--dsw-alias-state-error-primary);} .expl-menu-item.expl-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);}' +
      '.expl-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1);}' +
      '.expl-inline-input{flex:1;min-width:0;height:30px;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-state-business-primary);border-radius:6px;padding:0 5px;outline:none;font-family:var(--ds-font-family-code);}' +
      '.expl-toggle{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;} ' +
      '.expl-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-tool{width:34px;height:32px;padding:0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:transparent;border-radius:18px;font-size:15px;line-height:1;}' +
      '.expl-active{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);}' +
      '.expl-hero-dock{position:relative;width:100%;height:0;margin-top:-8px;pointer-events:none;}' +
      '.expl-hero-dock .expl-tool{position:absolute;right:calc(var(--dsh-composer-side-clearance) + 12px);bottom:0;width:28px;height:28px;border-radius:14px;font-size:14px;pointer-events:auto;}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/explorer.css"]') === null) {
      var tag = document.createElement('style')
      tag.dataset.plugin = '@lyhue1991/dsh-soup'
      tag.dataset.pluginCss = '@lyhue1991/dsh-soup/explorer.css'
      tag.textContent = EXPL_CSS
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------------
    // 工具栏图标：取自 JupyterLab ui-components（BSD-3-Clause，与文件类型
    // 图标同源的引用方式），fill 改为 currentColor 以跟随 DSH 主题 token。
    // ------------------------------------------------------------------
    var ICON_REFRESH = '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 18 18"><path fill="currentColor" d="M9 13.5c-2.49 0-4.5-2.01-4.5-4.5S6.51 4.5 9 4.5c1.24 0 2.36.52 3.17 1.33L10 8h5V3l-1.76 1.76A6 6 0 0 0 9 3C5.69 3 3.01 5.69 3.01 9S5.69 15 9 15a5.98 5.98 0 0 0 5.9-5h-1.52c-.46 2-2.24 3.5-4.38 3.5"/></svg>'
    var ICON_UPLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>'
    var ICON_CLOSE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 16 16"><path d="m13 4.2-1-1-3.8 3.8-3.8-3.8-1 1 3.8 3.8-3.8 3.8 1 1 3.8-3.8 3.8 3.8 1-1-3.8-3.8z" fill="currentColor"/></svg>'

    // GoalBar 多行版：沿用 DSH 原生 GoalBar 的结构和主题，仅放开单行截断。
    // 布局分两行：head 行（图标 + 相位标签 + 操作按钮），body 行（objective 多行）。
    var GOAL_CSS =
      '.dsh-goal-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;}' +
      '.dsh-goal-bar{box-sizing:border-box;display:flex;flex-direction:column;gap:4px;width:100%;max-width:calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));margin:0 auto;padding:6px 5px 6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-tip);font-family:var(--dsw-font-family);}' +
      '.dsh-goal-head{display:flex;align-items:center;gap:10px;min-width:0;}' +
      '.dsh-goal-glyph{display:inline-flex;align-items:center;height:24px;flex:none;color:var(--dsw-alias-label-tertiary);}' +
      '.dsh-goal-label{flex:none;font-size:13px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary);}' +
      '.dsh-goal-rounds{flex:none;font-size:11px;line-height:18px;color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code);}' +
      '.dsh-goal-objective{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary-dimmed);white-space:pre-wrap;overflow-wrap:anywhere;padding:0 22px 2px 0;}' +
      '.dsh-goal-error{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:20px;text-overflow:ellipsis;white-space:nowrap;}' +
      '.dsh-goal-input{box-sizing:border-box;width:100%;min-height:64px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);resize:none;overflow:hidden;outline:none;}' +
      '.dsh-goal-input:focus{border-color:var(--dsw-alias-state-business-primary);}' +
      '.dsh-goal-actions{display:flex;align-items:center;gap:10px;flex:none;height:28px;margin-left:auto;}' +
      '.dsh-goal-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}' +
      '.dsh-goal-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}' +
      '.dsh-goal-btn:disabled{opacity:.4;cursor:default;}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/goal.css"]') === null) {
      var goalTag = document.createElement('style')
      goalTag.dataset.plugin = '@lyhue1991/dsh-soup'
      goalTag.dataset.pluginCss = '@lyhue1991/dsh-soup/goal.css'
      goalTag.textContent = GOAL_CSS
      document.head.appendChild(goalTag)
    }

    // 文件标签页视图（conversation.view 'dsh-soup-files'）：子 tab 条 + 预览区。
    // 纯预览（无编辑）：markdown/html/json/csv 各有专属渲染器。
    var FILEVIEW_CSS =
      '.dfv-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);}' +
      '.dfv-tabbar{display:flex;align-items:center;gap:2px;flex:none;overflow-x:auto;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);scrollbar-width:none;}' +
      '.dfv-tabbar::-webkit-scrollbar{display:none;}' +
      '.dfv-tab{display:inline-flex;align-items:center;gap:5px;padding:5px 8px 5px 10px;border:none;border-radius:8px 8px 0 0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap;max-width:220px;}' +
      '.dfv-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.dfv-tab.active{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:inset 0 -2px 0 var(--dsw-alias-state-business-primary);}' +
      '.dfv-tab-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.dfv-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:none;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1;cursor:pointer;padding:0;}' +
      '.dfv-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.dfv-body{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);}' +
      '.dfv-toolbar{display:flex;align-items:center;gap:8px;flex:none;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);}' +
      '.dfv-toolbar-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-family:var(--ds-font-family-code);}' +
      '.dfv-btn{flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;box-sizing:border-box;background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;padding:0 10px;border-radius:7px;cursor:pointer;}' +
      '.dfv-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.dfv-btn svg{width:14px;height:14px;display:block;flex:none;}' +
      '.dfv-error{padding:8px 14px;font-size:12px;color:var(--dsw-alias-state-error-primary);flex:none;}' +
      '.dfv-muted{padding:24px 14px;font-size:13px;color:var(--dsw-alias-label-tertiary);text-align:center;}' +
      '.dfv-cap{padding:5px 14px;font-size:11px;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.dfv-code{flex:1;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;overflow:auto;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55;white-space:pre;tab-size:2;user-select:text;}' +
      '.dfv-code-wrap{flex:1;min-height:0;overflow:auto;padding:8px 10px;}' +
      '.dfv-nb{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);}' +
      '.dfv-nb-cell{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1);}' +
      '.dfv-nb-gutter{flex:none;width:44px;padding:8px 6px;text-align:right;font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l1);user-select:none;background:var(--dsw-specific-sidebar-fill);}' +
      '.dfv-nb-cellbody{flex:1;min-width:0;padding:4px 0;}' +
      '.dfv-nb-cellbody .md-code-block,.dfv-nb-cellbody .dfv-code{margin:4px 10px;border-radius:8px;overflow:hidden;}' +
      '.dfv-nb-cell.dfv-nb-markdown .dfv-md-wrap{padding:2px 14px;}' +
      '.dfv-nb-raw{color:var(--dsw-alias-label-secondary);}' +
      '.dfv-nb-outputs{border-top:1px dashed var(--dsw-alias-border-l1);padding:6px 10px;display:flex;flex-direction:column;gap:8px;}' +
      '.dfv-nb-out{margin:0;padding:6px 8px;font-family:var(--ds-font-family-code);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border-radius:6px;max-height:320px;overflow:auto;}' +
      '.dfv-nb-out-err{color:var(--dsw-alias-state-error-primary);}' +
      '.dfv-nb-error{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;overflow:hidden;}' +
      '.dfv-nb-error-head{padding:5px 10px;font-family:var(--ds-font-family-code);font-size:12px;font-weight:600;color:#fff;background:var(--dsw-alias-state-error-primary);}' +
      '.dfv-nb-trace{margin:0;padding:8px 10px;font-family:var(--ds-font-family-code);font-size:11.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);max-height:260px;overflow:auto;}' +
      '.dfv-nb-img{max-width:100%;height:auto;border-radius:6px;}' +
      '.dfv-nb-html{width:100%;height:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:#fff;}' +
      '.dfv-md-wrap{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);}' +
      '.dfv-md{padding:6px 18px 16px;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-primary);}' +
      '.dfv-frame{flex:1;min-height:0;width:100%;border:none;background:#fff;}' +
      '.dfv-image-wrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;}' +
      '.dfv-image{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:var(--dsw-shadow-lv2);}' +
      '.dfv-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;}' +
      '.dfv-json .dfv-tok-key{color:#82aaff;}.dfv-json .dfv-tok-str{color:#9ece8f;}.dfv-json .dfv-tok-num{color:#e0a96d;}.dfv-json .dfv-tok-bool,.dfv-json .dfv-tok-null{color:#c792ea;}' +
      '.dfv-table-wrap{flex:1;min-height:0;overflow:auto;}' +
      '.dfv-table{border-collapse:collapse;font-size:12px;font-family:var(--ds-font-family-code);}' +
      '.dfv-th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;text-align:left;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);border-right:1px solid var(--dsw-alias-border-l1);white-space:nowrap;}' +
      '.dfv-td{padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;max-width:360px;}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/fileview.css"]') === null) {
      var fileviewTag = document.createElement('style')
      fileviewTag.dataset.plugin = '@lyhue1991/dsh-soup'
      fileviewTag.dataset.pluginCss = '@lyhue1991/dsh-soup/fileview.css'
      fileviewTag.textContent = FILEVIEW_CSS
      document.head.appendChild(fileviewTag)
    }

    /** 需要的客户端服务：slots、layout、timer、sessions + remote.goals（goal 动作动词）。 */
    var inject = ['slots', 'layout', 'timer', 'sessions', 'remote', 'remote.goals']

    // ------------------------------------------------------------------
    // 状态存储（模块级，供 Panel 与 HeaderAction 共享）
    // ------------------------------------------------------------------
    var state = {
      open: false, cwd: '', tree: [], menu: null, error: '', notice: '',
      selected: new Set(), lastIndex: null,
      renaming: null, newItem: null,
      dropTarget: null, dragPaths: null,
      files: { list: [], active: null },
      uploads: [],
    }
    var listeners = new Set()
    function setState(patch) {
      state = Object.assign({}, state, patch)
      listeners.forEach(function (fn) { fn() })
    }
    function subscribe(fn) {
      listeners.add(fn)
      return function () { listeners.delete(fn) }
    }
    function useStore() {
      var force = React.useReducer(function (x) { return x + 1 }, 0)[1]
      React.useEffect(function () { return subscribe(function () { force() }) }, [])
      return state
    }

    var visibleRows = []
    var uploadInputEl = null
    var layout = null

    var DETAILS_MIN = 264
    var DETAILS_MAX = 420
    var DETAILS_DEFAULT = 280
    function clampW(w) { return Math.max(DETAILS_MIN, Math.min(DETAILS_MAX, w)) }

    function pathJoin(dir, name) { return String(dir || '/').replace(/\/+$/, '') + '/' + name }
    function parentOf(path) {
      var p = String(path || '/').replace(/\/+$/, '')
      var i = p.lastIndexOf('/')
      return i <= 0 ? '/' : p.slice(0, i)
    }
    function baseName(path) {
      var p = String(path || '').replace(/\/+$/, '')
      var i = p.lastIndexOf('/')
      return i < 0 ? p : p.slice(i + 1)
    }

    // ------------------------------------------------------------------
    // 与宿主通信：POST /api/dsh-soup
    // ------------------------------------------------------------------
    function hostBase() {
      var origin = globalThis.location && globalThis.location.origin
      return origin !== undefined && origin !== 'null' && origin !== '' ? origin : 'http://dsh.internal'
    }
    function rpc(action, args) {
      return fetch(new URL('/api/dsh-soup', hostBase()), {
        method: 'POST',
        // x-dsh-soup：宿主路由的强制头（防跨站简单请求伪造），
        // content-type 必须 application/json，两者缺一会被 403。
        headers: { 'content-type': 'application/json', 'x-dsh-soup': '1' },
        body: JSON.stringify({ action: action, args: args || {} }),
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: '宿主响应解析失败' } })
      }).catch(function (err) {
        return { ok: false, error: '宿主不可达: ' + String((err && err.message) || err) }
      })
    }

    async function loadDir(path, attempt) {
      var res = await rpc('list', { path: path, sessionId: activeSessionId })
      // 新会话刚切换时，宿主会话注册表可能尚未纳入其 cwd——稍候重试。
      if ((!res || !res.ok) && /超出允许范围/.test((res && res.error) || '') && (attempt || 0) < 3) {
        await new Promise(function (r) { setTimeout(r, 600) })
        return loadDir(path, (attempt || 0) + 1)
      }
      if (!res || !res.ok) {
        setState({ error: (res && res.error) || '读取失败' })
        return null
      }
      return res.entries || []
    }

    async function defaultCwd(sessionId, hint) {
      // 以会话工作目录为准：优先用客户端会话快照里的 cwd（与官方细节栏同源，
      // 始终指向"当前会话所在项目"），其次查宿主会话 header。
      if (hint) return hint
      if (sessionId) {
        var res = await rpc('sessionCwd', { sessionId: sessionId })
        if (res && res.ok && res.cwd) return res.cwd
      }
      // 已知会话但不能确定其工作目录时，回退到文件系统根，而不是"宿主启动目录"——
      // 后者（root）会让资源管理器误显示与当前会话无关的启动路径。
      return '/'
    }

    async function trackSession(sessionId, cwdHint) {
      activeSessionId = sessionId || null
      var cwd = await defaultCwd(sessionId, cwdHint)
      // 会话切换：预览列表按新 cwd 裁剪（范围外自动关闭），并清掉上一路径的旧错误横幅
      var files = pruneFilesToScope(state.files, cwd)
      lastMtimes = {} // 换了目录，旧 mtime 基线全部作废（首轮 tick 重建基线）
      setState({ cwd: cwd, selected: new Set(), renaming: null, newItem: null, menu: null, error: '', notice: '', files: files })
      var items = await loadDir(cwd)
      if (items) setState({ error: '', tree: items })
    }

    async function refresh() {
      if (!state.cwd) return
      var items = await loadDir(state.cwd)
      if (items) setState({ error: '', tree: items })
    }

    // ------------------------------------------------------------------
    // 自动刷新：低频轮询宿主 mtime 探测（3s 一次），签名变了才真正重拉。
    // watch 范围 = 当前 cwd + 已展开目录 + 打开的预览文件；面板关闭且无
    // 预览时整个 tick 直接返回（零请求）。不做文件 watcher——fs.watch
    // 递归语义跨平台不一致且大工作区开销高，stat 几个路径便宜得多。
    // ------------------------------------------------------------------
    var AUTO_REFRESH_MS = 3000
    var AUTO_WATCH_MAX = 64
    var lastMtimes = {}   // path -> {m,s,d}|null；undefined = 尚无基线（首轮只建基线不触发）
    var autoTicking = false

    function collectWatchPaths() {
      var paths = []
      if (state.cwd) paths.push(state.cwd)
      var walk = function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i]
          if (n.type === 'directory' && n.children != null) {
            paths.push(n.path)
            if (n.open && n.children.length) walk(n.children)
          }
        }
      }
      walk(state.tree)
      for (var j = 0; j < state.files.list.length; j++) {
        var e = state.files.list[j]
        if (e.path && paths.indexOf(e.path) < 0) paths.push(e.path)
      }
      return paths.slice(0, AUTO_WATCH_MAX)
    }

    /** 预览文件在磁盘上变了：静默重读该 entry（不动激活状态、不闪 tab）。 */
    async function silentReloadEntry(entry) {
      var res = await rpc('read', { path: entry.path, sessionId: activeSessionId })
      if (!res || !res.ok) return
      entry.kind = res.kind
      entry.size = res.size || 0
      if (res.kind === 'text') { entry.content = res.content; entry.truncated = !!res.truncated }
      else if (res.kind === 'image') { entry.dataUrl = 'data:' + res.mime + ';base64,' + res.data }
      else if (res.kind === 'pdf') { entry.data = res.data }
      setFiles({ list: state.files.list.slice() })
    }

    /** 已展开目录的子项变了：重拉该目录（保持展开态）。 */
    async function reloadDirNode(node) {
      var items = await loadDir(node.path)
      if (items) items.forEach(function (c) { c.parent = node })
      node.children = items || []
      node.open = true
      setState({ tree: state.tree })
    }

    /**
     * 探一轮。返回 'idle'（本轮没发请求）/ true（探测成功）/ false（请求失败）。
     * 只有真正发出去且失败的请求才累积退避；空闲不累积——面板重开时本就有
     * 一次全量 loadDir，无需为"关着的时候宿主是否恢复"操心。
     */
    async function autoRefreshTick() {
      if (autoTicking) return 'idle'
      if (!state.open && state.files.list.length === 0) return 'idle'
      // 用户正在操作（重命名/新建/右键菜单）时跳过本轮，避免打断输入
      if (state.renaming || state.newItem || state.menu) return 'idle'
      var paths = collectWatchPaths()
      if (!paths.length) return 'idle'
      autoTicking = true
      try {
        var res = await rpc('mtime', { paths: paths })
        if (!res || !res.ok) return false
        var mtimes = res.mtimes || {}
        var dirtyDirs = []
        var dirtyFiles = []
        for (var i = 0; i < paths.length; i++) {
          var p = paths[i]
          var now = Object.prototype.hasOwnProperty.call(mtimes, p) ? mtimes[p] : null
          var prev = Object.prototype.hasOwnProperty.call(lastMtimes, p) ? lastMtimes[p] : undefined
          lastMtimes[p] = now
          if (prev === undefined || prev === null || now === null) continue
          if (now.m === prev.m && now.s === prev.s) continue
          if (now.d) dirtyDirs.push(p)
          else dirtyFiles.push(p)
        }
        for (var d = 0; d < dirtyDirs.length; d++) {
          var dp = dirtyDirs[d]
          if (dp === state.cwd) { await refresh(); continue }
          var node = findNode(state.tree, dp)
          if (node && node.children != null) await reloadDirNode(node)
        }
        for (var f = 0; f < dirtyFiles.length; f++) {
          var entry = findFileEntry(dirtyFiles[f])
          if (entry && entry.loaded) await silentReloadEntry(entry)
        }
        return true
      } finally {
        autoTicking = false
      }
    }

    // 失败退避：宿主不可达（DSH 重启中 / 插件重载 / 断连）时别每 3s 硬打——
    // 指数退避 3s→6s→12s→24s→48s，封顶 60s；一旦成功回到 3s。
    // （JupyterLab FileBrowserModel 的 Poll 同思路：backoff + max 封顶。）
    // 实现：1s 固定心跳 + 「到期才探测」，而不是变间隔定时器——宿主提供的
    // timer 服务可 dispose，测试环境（interval 为 no-op mock）也不会挂住进程。
    var AUTO_HEARTBEAT_MS = 1000
    var AUTO_BACKOFF_MAX_MS = 60000
    var autoFailCount = 0
    var autoLastProbeAt = 0

    function autoDelayMs() {
      if (autoFailCount <= 0) return AUTO_REFRESH_MS
      return Math.min(AUTO_REFRESH_MS * Math.pow(2, autoFailCount), AUTO_BACKOFF_MAX_MS)
    }

    function autoHeartbeat() {
      var now = Date.now()
      if (now - autoLastProbeAt < autoDelayMs()) return
      autoLastProbeAt = now
      autoRefreshTick().then(function (outcome) {
        if (outcome === false) autoFailCount++
        else autoFailCount = 0
      })
    }

    /** 手动刷新：重拉根目录，已展开的子目录逐个重拉、保持展开不收起。 */
    async function refreshAll() {
      if (!state.cwd) return
      var expanded = []
      var walk = function (nodes) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i]
          if (n.type === 'directory' && n.children != null) {
            if (n.path !== state.cwd) expanded.push({ path: n.path, open: !!n.open })
            if (n.open && n.children.length) walk(n.children)
          }
        }
      }
      walk(state.tree)
      await refresh()
      for (var j = 0; j < expanded.length; j++) {
        if (!expanded[j].open) continue
        var node = findNode(state.tree, expanded[j].path)
        if (node) await reloadDirNode(node)
      }
    }

    async function toggleNode(node) {
      if (node.type !== 'directory') return
      if (node.children == null) {
        node.loading = true
        setState({ tree: state.tree })
        var items = await loadDir(node.path)
        node.loading = false
        if (items) items.forEach(function (c) { c.parent = node })
        node.children = items || []
        node.open = true
        setState({ tree: state.tree })
      } else {
        node.open = !node.open
        setState({ tree: state.tree })
      }
    }

    function formatSize(n) {
      if (typeof n !== 'number' || n < 0) return ''
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(1) + ' GB'
    }

    // ------------------------------------------------------------------
    // 文件类型图标：采用 JupyterLab ui-components 的 filetype SVG 集
    // （BSD-3-Clause License，github.com/jupyterlab/jupyterlab）。
    // 固定品牌色、16px 渲染；未命中扩展名按「代码文件→编辑器图标、其余→空白文件」兜底。
    // ------------------------------------------------------------------
    var NB_SVG = {
      folder: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 24 24"><path fill="#FBC02D" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8z" class="jp-icon3 jp-icon-selectable"/></svg>',
      folderFavorite: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#000" viewBox="0 0 24 24"><path fill="#F9A825" d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2m-2.06 11L15 15.28 12.06 17l.78-3.33-2.59-2.24 3.41-.29L15 8l1.34 3.14 3.41.29-2.59 2.24z" class="jp-icon3 jp-icon-selectable"/></svg>',
      file: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><path fill="currentColor" d="m19.3 8.2-5.5-5.5c-.3-.3-.7-.5-1.2-.5H3.9c-.8.1-1.6.9-1.6 1.8v14.1c0 .9.7 1.6 1.6 1.6h14.2c.9 0 1.6-.7 1.6-1.6V9.4c.1-.5-.1-.9-.4-1.2m-5.8-3.3 3.4 3.6h-3.4zm3.9 12.7H4.7c-.1 0-.2 0-.2-.2V4.7c0-.2.1-.3.2-.3h7.2v4.4s0 .8.3 1.1 1.1.3 1.1.3h4.3v7.2s-.1.2-.2.2" class="jp-icon3 jp-icon-selectable"/></svg>',
      textEditor: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15 15H3v2h12zm0-8H3v2h12zM3 13h18v-2H3zm0 8h18v-2H3zM3 3v2h18V3z" class="jp-text-editor-icon-color jp-icon-selectable"/></svg>',
      markdown: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><path fill="#7B1FA2" d="M5 14.9h12l-6.1 6zm9.4-6.8c0-1.3-.1-2.9-.1-4.5-.4 1.4-.9 2.9-1.3 4.3l-1.3 4.3h-2L8.5 7.9c-.4-1.3-.7-2.9-1-4.3-.1 1.6-.1 3.2-.2 4.6L7 12.4H4.8l.7-11h3.3L10 5c.4 1.2.7 2.7 1 3.9.3-1.2.7-2.6 1-3.9l1.2-3.7h3.3l.6 11h-2.4z" class="jp-icon-contrast0 jp-icon-selectable"/></svg>',
      notebook: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><g fill="#EF6C00" class="jp-notebook-icon-color jp-icon-selectable"><path d="M18.7 3.3v15.4H3.3V3.3zm1.5-1.5H1.8v18.3h18.3z"/><path d="m16.5 16.5-5.4-4.3-5.6 4.3v-11h11z"/></g></svg>',
      json: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><g fill="#F9A825" class="jp-json-icon-color jp-icon-selectable"><path d="M20.2 11.8c-1.6 0-1.7.5-1.7 1 0 .4.1.9.1 1.3.1.5.1.9.1 1.3 0 1.7-1.4 2.3-3.5 2.3h-.9v-1.9h.5c1.1 0 1.4 0 1.4-.8 0-.3 0-.6-.1-1 0-.4-.1-.8-.1-1.2 0-1.3 0-1.8 1.3-2-1.3-.2-1.3-.7-1.3-2 0-.4.1-.8.1-1.2.1-.4.1-.7.1-1 0-.8-.4-.7-1.4-.8h-.5V4.1h.9c2.2 0 3.5.7 3.5 2.3 0 .4-.1.9-.1 1.3-.1.5-.1.9-.1 1.3 0 .5.2 1 1.7 1zM1.8 10.1c1.6 0 1.7-.5 1.7-1 0-.4-.1-.9-.1-1.3-.1-.5-.1-.9-.1-1.3 0-1.6 1.4-2.3 3.5-2.3h.9v1.9h-.5c-1 0-1.4 0-1.4.8 0 .3 0 .6.1 1 0 .2.1.6.1 1 0 1.3 0 1.8-1.3 2C6 11.2 6 11.7 6 13c0 .4-.1.8-.1 1.2-.1.3-.1.7-.1 1 0 .8.3.8 1.4.8h.5v1.9h-.9c-2.1 0-3.5-.6-3.5-2.3 0-.4.1-.9.1-1.3.1-.5.1-.9.1-1.3 0-.5-.2-1-1.7-1z"/><circle cx="11" cy="13.8" r="2.1"/><circle cx="11" cy="8.2" r="2.1"/></g></svg>',
      yaml: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><g fill="#D81B60" class="jp-icon-contrast2 jp-icon-selectable"><path d="M7.2 18.6v-5.4L3 5.6h3.3l1.4 3.1c.3.9.6 1.6 1 2.5.3-.8.6-1.6 1-2.5l1.4-3.1h3.4l-4.4 7.6v5.5z"/><circle cx="17.6" cy="16.5" r="2.1"/><circle cx="17.6" cy="11" r="2.1"/></g></svg>',
      python: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="-10 -10 131.161 132.389"><path fill="#306998" d="M54.919 0c-4.584.022-8.961.413-12.813 1.095C30.76 3.099 28.7 7.295 28.7 15.032v10.219h26.813v3.406H18.638c-7.793 0-14.616 4.684-16.75 13.594-2.462 10.213-2.571 16.586 0 27.25 1.905 7.938 6.457 13.594 14.25 13.594h9.218v-12.25c0-8.85 7.657-16.657 16.75-16.657h26.782c7.454 0 13.406-6.138 13.406-13.625v-25.53c0-7.267-6.13-12.726-13.406-13.938C64.282.328 59.502-.02 54.918 0m-14.5 8.22c2.77 0 5.031 2.298 5.031 5.125 0 2.816-2.262 5.093-5.031 5.093-2.78 0-5.031-2.277-5.031-5.093 0-2.827 2.251-5.125 5.03-5.125" class="jp-icon-selectable"/><path fill="#ffd43b" d="M85.638 28.657v11.906c0 9.231-7.826 17-16.75 17H42.106c-7.336 0-13.406 6.279-13.406 13.625V96.72c0 7.266 6.319 11.54 13.406 13.625 8.488 2.495 16.627 2.946 26.782 0 6.75-1.955 13.406-5.888 13.406-13.625V86.5H55.513v-3.405H95.7c7.793 0 10.696-5.436 13.406-13.594 2.8-8.399 2.68-16.476 0-27.25-1.925-7.758-5.604-13.594-13.406-13.594zM70.575 93.313c2.78 0 5.031 2.278 5.031 5.094 0 2.827-2.251 5.125-5.031 5.125-2.77 0-5.031-2.298-5.031-5.125 0-2.816 2.261-5.094 5.031-5.094" class="jp-icon-selectable"/></svg>',
      julia: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 325 300"><path fill="#cb3c33" d="M150.898 225c0 41.422-33.578 75-75 75s-75-33.578-75-75 33.579-75 75-75 75 33.578 75 75" class="jp-brand0 jp-icon-selectable"/><path fill="#389826" d="M237.5 75c0 41.422-33.578 75-75 75s-75-33.578-75-75 33.578-75 75-75 75 33.578 75 75" class="jp-brand0 jp-icon-selectable"/><path fill="#9558b2" d="M324.102 225c0 41.422-33.579 75-75 75s-75-33.578-75-75 33.578-75 75-75 75 33.578 75 75" class="jp-brand0 jp-icon-selectable"/></svg>',
      rKernel: '<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" width="16" height="16" viewBox="0 0 724 561"><path class="jp-icon-selectable" d="M361.453,485.937 C162.329,485.937 0.906,377.828 0.906,244.469 C0.906,111.109 162.329,3.000 361.453,3.000 C560.578,3.000 722.000,111.109 722.000,244.469 C722.000,377.828 560.578,485.937 361.453,485.937 ZM416.641,97.406 C265.289,97.406 142.594,171.314 142.594,262.484 C142.594,353.654 265.289,427.562 416.641,427.562 C567.992,427.562 679.687,377.033 679.687,262.484 C679.687,147.971 567.992,97.406 416.641,97.406 Z" fill="rgb(179,179,179)" fill-rule="evenodd"/><path class="jp-icon-selectable" d="M550.000,377.000 C550.000,377.000 571.822,383.585 584.500,390.000 C588.899,392.226 596.510,396.668 602.000,402.500 C607.378,408.212 610.000,414.000 610.000,414.000 L696.000,559.000 L557.000,559.062 L492.000,437.000 C492.000,437.000 478.690,414.131 470.500,407.500 C463.668,401.969 460.755,400.000 454.000,400.000 C449.298,400.000 420.974,400.000 420.974,400.000 L421.000,558.974 L298.000,559.026 L298.000,152.938 L545.000,152.938 C545.000,152.938 657.500,154.967 657.500,262.000 C657.500,369.033 550.000,377.000 550.000,377.000 ZM496.500,241.024 L422.037,240.976 L422.000,310.026 L496.500,310.002 C496.500,310.002 531.000,309.895 531.000,274.877 C531.000,239.155 496.500,241.024 496.500,241.024 Z" fill="rgb(52,101,176)" fill-rule="evenodd"/></svg>',
      spreadsheet: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><path fill="#4CAF50" d="M2.2 2.2v17.6h17.6V2.2zm15.4 7.7h-5.5V4.4h5.5zM9.9 4.4v5.5H4.4V4.4zm-5.5 7.7h5.5v5.5H4.4zm7.7 5.5v-5.5h5.5v5.5z" class="jp-icon-contrast1 jp-icon-selectable"/></svg>',
      pdf: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><path fill="#FF2A2A" d="m17.933 13.667 3.987 3.987-1.117 1.117-2.51-2.51-1.066 1.067 2.36 2.36-1.117 1.117-2.36-2.36-2.43 2.429-1.477-1.478zm-6.163-3.93-3.496 3.496.53.53q.905.906 1.83.932.929.031 1.784-.825.852-.852.822-1.773t-.94-1.83zm-.36-2.594 1.557 1.558q1.305 1.305 1.754 2.13.456.825.468 1.727.015.79-.296 1.493-.31.702-.951 1.343-.649.648-1.355.963-.702.31-1.493.295-.905-.015-1.738-.472-.829-.46-2.118-1.75L5.68 12.874zm-5.76-5.76L8.1 3.835Q9.195 4.93 9.291 6q.103 1.07-.795 1.968-.901.902-1.976.802-1.067-.1-2.16-1.193l-.975-.975L1.397 8.59-.08 7.113Zm.406 2.548-1.6 1.6.817.818q.43.43.871.457.445.023.829-.361t.357-.825-.457-.871z" class="jp-icon-selectable"/></svg>',
      image: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 22 22"><path fill="#FFF" d="M2.2 2.2h17.5v17.5H2.2z" class="jp-icon-brand4 jp-icon-selectable-inverse"/><path fill="#3F51B5" d="M2.2 2.2v17.5h17.5l.1-17.5zm12.1 2.2c1.2 0 2.2 1 2.2 2.2s-1 2.2-2.2 2.2-2.2-1-2.2-2.2 1-2.2 2.2-2.2M4.4 17.6l3.3-8.8 3.3 6.6 2.2-3.2 4.4 5.4z" class="jp-icon-brand0 jp-icon-selectable"/></svg>',
      html5: '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 512 512"><path fill="#000" d="M108.4 0h23v22.8h21.2V0h23v69h-23V46h-21v23h-23.2M206 23h-20.3V0h63.7v23H229v46h-23m53.5-69h24.1l14.8 24.3L313.2 0h24.1v69h-23V34.8l-16.1 24.8-16.1-24.8V69h-22.6m89.2-69h23v46.2h32.6V69h-55.6" class="jp-icon0 jp-icon-selectable"/><path fill="#e44d26" d="m107.6 471-33-370.4h362.8l-33 370.2L255.7 512" class="jp-icon-selectable"/><path fill="#f16529" d="M256 480.5V131h148.3L376 447" class="jp-icon-selectable"/><path fill="#ebebeb" d="M142 176.3h114v45.4h-64.2l4.2 46.5h60v45.3H154.4m2 22.8H202l3.2 36.3 50.8 13.6v47.4l-93.2-26" class="jp-icon-selectable-inverse"/><path fill="#fff" d="M369.6 176.3H255.8v45.4h109.6m-4.1 46.5H255.8v45.4h56l-5.3 59-50.7 13.6v47.2l93-25.8" class="jp-icon-selectable-inverse"/></svg>',
    }

    /** 扩展名 → JupyterLab filetype 图标；未命中走代码编辑器/空白文件兜底。 */
    function iconSvgFor(node) {
      if (node.type === 'directory') return node.open ? NB_SVG.folderFavorite : NB_SVG.folder
      var ext = extOfName(node.name)
      if (Object.prototype.hasOwnProperty.call(FILE_ICON_BY_EXT, ext)) return FILE_ICON_BY_EXT[ext]
      // 已知代码/配置语言 → 文本编辑器图标；其余（LICENSE、无扩展名等）→ 空白文件
      var codeish = Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, ext)
        || ['css', 'scss', 'less', 'xml', 'log', 'gitignore'].indexOf(ext) >= 0
        || ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].indexOf(ext) >= 0
      return codeish ? NB_SVG.textEditor : NB_SVG.file
    }

    var FILE_ICON_BY_EXT = {
      ipynb: NB_SVG.notebook,
      md: NB_SVG.markdown, markdown: NB_SVG.markdown,
      json: NB_SVG.json, jsonc: NB_SVG.json,
      yaml: NB_SVG.yaml, yml: NB_SVG.yaml,
      py: NB_SVG.python, jl: NB_SVG.julia, r: NB_SVG.rKernel,
      csv: NB_SVG.spreadsheet, tsv: NB_SVG.spreadsheet, xls: NB_SVG.spreadsheet, xlsx: NB_SVG.spreadsheet,
      pdf: NB_SVG.pdf,
      png: NB_SVG.image, jpg: NB_SVG.image, jpeg: NB_SVG.image, gif: NB_SVG.image,
      webp: NB_SVG.image, svg: NB_SVG.image, bmp: NB_SVG.image, ico: NB_SVG.image,
      html: NB_SVG.html5, htm: NB_SVG.html5,
    }

    function findNode(nodes, path) {
      if (!Array.isArray(nodes)) return null
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]
        if (n.path === path) return n
        if (Array.isArray(n.children) && n.children.length) {
          var r = findNode(n.children, path)
          if (r) return r
        }
      }
      return null
    }

    function rowIndex(path) {
      for (var i = 0; i < visibleRows.length; i++) if (visibleRows[i] === path) return i
      return -1
    }

    function onRowClick(e, node) {
      e.stopPropagation()
      var path = node.path
      var meta = e.metaKey || e.ctrlKey
      var shift = e.shiftKey
      var sel = new Set(state.selected)
      var lastIndex = state.lastIndex
      if (shift && lastIndex != null) {
        var idx = rowIndex(path)
        var from = Math.min(lastIndex, idx)
        var to = Math.max(lastIndex, idx)
        for (var i = from; i <= to; i++) { if (visibleRows[i]) sel.add(visibleRows[i]) }
      } else if (meta) {
        if (sel.has(path)) sel.delete(path); else sel.add(path)
        lastIndex = rowIndex(path)
      } else {
        sel.clear(); sel.add(path); lastIndex = rowIndex(path)
      }
      setState({ selected: sel, lastIndex: lastIndex })
    }

    function onRowDoubleClick(node) {
      if (node.type === 'directory') {
        toggleNode(node)
      } else {
        openFileInTab(node.path)
      }
    }

    function onRowContext(e, node) {
      e.preventDefault()
      e.stopPropagation()
      var sel = new Set(state.selected)
      if (!sel.has(node.path)) { sel.clear(); sel.add(node.path); setState({ selected: sel }) }
      setState({ menu: { x: e.clientX, y: e.clientY, node: node } })
    }

    function onBlankContext(e) {
      e.preventDefault()
      e.stopPropagation()
      setState({ selected: new Set(), lastIndex: null, menu: { x: e.clientX, y: e.clientY, node: null } })
    }

    function onBlankClick(e) {
      if (e.target && e.target.closest && e.target.closest('[data-path]')) return
      setState({ selected: new Set(), lastIndex: null })
    }

    async function openSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      for (var i = 0; i < paths.length; i++) await rpc('open', { path: paths[i] })
    }

    async function trashSelection() {
      var paths = Array.from(state.selected)
      setState({ menu: null })
      var errors = []
      for (var i = 0; i < paths.length; i++) {
        var res = await rpc('trash', { path: paths[i] })
        if (!res || !res.ok) errors.push(baseName(paths[i]) + ': ' + ((res && res.error) || '失败') + ((res && res.hint) ? '（' + res.hint + '）' : ''))
      }
      if (errors.length) setState({ error: errors.join('；') })
      setState({ selected: new Set(), lastIndex: null })
      await refresh()
    }

    function startRename(node) { setState({ renaming: node.path, menu: null }) }

    function commitRename(path, name) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        setState({ renaming: null })
        return
      }
      var dir = parentOf(path)
      var dest = pathJoin(dir, name)
      var sel = new Set(state.selected)
      if (sel.has(path)) { sel.delete(path); sel.add(dest) }
      setState({ renaming: null, selected: sel })
      ;(async function () {
        var res = await rpc('move', { from: path, to: dest })
        if (!res || !res.ok) setState({ error: (res && res.error) || '重命名失败' })
        await refresh()
      })()
    }

    function startNew(parent, isDir) {
      setState({ newItem: { parent: parent, isDir: isDir }, menu: null })
      if (parent !== state.cwd) {
        var parentNode = findNode(state.tree, parent)
        if (parentNode && parentNode.children == null) toggleNode(parentNode)
      }
    }

    function commitNew(parent, name, isDir) {
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        setState({ newItem: null })
        return
      }
      setState({ newItem: null })
      ;(async function () {
        var res = await rpc('create', { dir: parent, name: name, isDir: isDir })
        if (!res || !res.ok) setState({ error: (res && res.error) || '创建失败' })
        await refresh()
      })()
    }

    /** 成功通知：3 秒后自动消失（仅当未被更新的消息覆盖时才清除）。 */
    var noticeTimer = null
    function showNotice(text) {
      setState({ notice: text, error: '' })
      if (noticeTimer) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(function () {
        if (state.notice === text) setState({ notice: '' })
      }, 3000)
    }

    function copyPath(target) {
      var p = target && target.path ? target.path : state.cwd
      setState({ menu: null })
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(p).then(function () { showNotice('已复制路径') }).catch(function () {})
        }
      } catch (err) {}
    }

    function onDragStart(e, node) {
      var paths = state.selected.has(node.path) ? Array.from(state.selected) : [node.path]
      setState({ dragPaths: paths })
      try { e.dataTransfer.setData('text/plain', paths.join('\n')) } catch (err) {}
      e.dataTransfer.effectAllowed = 'move'
    }

    function doDrop(e, targetDir) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        uploadFiles(targetDir, Array.from(e.dataTransfer.files))
        return
      }
      movePaths(state.dragPaths || [], targetDir)
    }

    function onRowDrop(e, node) {
      e.preventDefault()
      e.stopPropagation()
      if (node.type !== 'directory') return
      doDrop(e, node.path)
      setState({ dropTarget: null })
    }

    function onBodyDrop(e) {
      e.preventDefault()
      doDrop(e, state.cwd)
      setState({ dropTarget: null })
    }

    async function movePaths(paths, targetDir) {
      var errors = []
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i]
        if (p === '/' || !p) continue
        var name = baseName(p)
        var dest = pathJoin(targetDir, name)
        if (dest === p) continue
        if (targetDir === p || targetDir.startsWith(p + '/')) { errors.push('不能把文件夹移入自身: ' + name); continue }
        var res = await rpc('move', { from: p, to: dest })
        if (!res || !res.ok) errors.push(name + ': ' + ((res && res.error) || '失败'))
      }
      setState({ dragPaths: null })
      if (errors.length) setState({ error: errors.join('；') })
      await refresh()
    }

    function fileToBase64(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader()
        r.onload = function () { var s = String(r.result || ''); var i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s) }
        r.onerror = function () { reject(new Error('读取文件失败')) }
        r.readAsDataURL(file)
      })
    }

    /** 单块大小：超过则走分块通道（JupyterLab 同款 1MB）。 */
    var UPLOAD_CHUNK_SIZE = 1024 * 1024

    function setUploadEntry(entry) {
      var list = (state.uploads || []).slice()
      var found = false
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === entry.name) { list[i] = entry; found = true; break }
      }
      if (!found) list.push(entry)
      setState({ uploads: list })
    }

    function updateUpload(name, loaded, total, idx, totalFiles, down) {
      setUploadEntry({ name: name, loaded: loaded, total: total, idx: idx, totalFiles: totalFiles, done: false, down: !!down })
    }

    function finishUploads(count, okCount, failedName, down) {
      var verb = down ? '已下载' : '已上传'
      setUploadEntry({
        name: '✓ ' + verb + ' ' + (okCount === count ? count + ' 个文件' : okCount + '/' + count + ' 个文件' + (failedName ? '（' + failedName + ' 失败）' : '')),
        loaded: 0, total: 0, idx: 0, totalFiles: 0, done: true, down: !!down,
      })
      window.setTimeout(function () { setState({ uploads: [] }) }, 1600)
    }

    /** 单文件分块上传：>1MB 切片逐块 POST，首块覆盖、后续追加。 */
    async function uploadOneFile(dir, f, idx, totalFiles) {
      var chunked = f.size > UPLOAD_CHUNK_SIZE
      var chunks = Math.max(1, Math.ceil(f.size / UPLOAD_CHUNK_SIZE))
      updateUpload(f.name, 0, f.size, idx, totalFiles)
      for (var c = 0; c < chunks; c++) {
        var start = c * UPLOAD_CHUNK_SIZE
        var blob = f.slice(start, Math.min(f.size, start + UPLOAD_CHUNK_SIZE))
        var b64 = await fileToBase64(blob)
        var res = await rpc('upload', {
          dir: dir, name: f.name, data: b64,
          chunk: chunked ? c + 1 : undefined,
        })
        if (!res || !res.ok) throw new Error((res && res.error) || '上传失败')
        updateUpload(f.name, Math.min(f.size, start + UPLOAD_CHUNK_SIZE), f.size, idx, totalFiles)
      }
    }

    async function uploadFiles(dir, files) {
      if (!files || !files.length) return
      var errors = []
      var okCount = 0
      for (var i = 0; i < files.length; i++) {
        var f = files[i]
        try {
          await uploadOneFile(dir, f, i + 1, files.length)
          okCount++
        } catch (err) {
          errors.push(f.name + ': ' + String((err && err.message) || err))
        }
      }
      finishUploads(files.length, okCount, errors.length ? errors[0].split(':')[0] : '')
      if (errors.length) setState({ error: errors.join('；'), notice: '' })
      await refresh()
    }

    /** ≤100MB 走页面内 fetch + 进度行 + Blob 另存；>100MB 走浏览器原生下载。 */
    var DOWNLOAD_PROGRESS_LIMIT = 100 * 1024 * 1024

    async function downloadFile(path) {
      setState({ menu: null })
      var res = await rpc('download', { path: path, sessionId: activeSessionId })
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 600) })
        res = await rpc('download', { path: path, sessionId: activeSessionId })
      }
      if (!res || !res.ok) {
        setState({ error: (res && res.error) || '下载失败' })
        return
      }
      var name = res.name || baseName(path)
      var size = res.size || 0
      // 大文件：浏览器原生下载（流式落盘、零内存），无进度
      if (size > DOWNLOAD_PROGRESS_LIMIT) {
        var a = document.createElement('a')
        a.href = res.url
        a.download = name
        document.body.appendChild(a)
        a.click()
        a.remove()
        showNotice('已开始下载 ' + name + '（大文件，由浏览器接管）')
        return
      }
      // 中小文件：fetch 流式读字节计进度，完成后 Blob 另存（峰值≈文件体积）
      updateUpload(name, 0, size, 0, 1, true)
      try {
        var r = await fetch(res.url)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        var total = Number(r.headers.get('content-length')) || size
        var reader = r.body.getReader()
        var received = 0
        var chunks = []
        for (;;) {
          var part = await reader.read()
          if (part.done) break
          chunks.push(part.value)
          received += part.value.length
          updateUpload(name, received, total, 0, 1, true)
        }
        var blobUrl = URL.createObjectURL(new Blob(chunks))
        var da = document.createElement('a')
        da.href = blobUrl
        da.download = name
        document.body.appendChild(da)
        da.click()
        da.remove()
        window.setTimeout(function () { URL.revokeObjectURL(blobUrl) }, 5000)
        finishUploads(1, 1, '', true)
      } catch (err) {
        setState({ error: '下载失败: ' + String((err && err.message) || err), uploads: [] })
      }
    }

    function onUploadPicker(e) {
      var files = Array.from((e.target && e.target.files) || [])
      uploadFiles(state.cwd, files)
      e.target.value = ''
    }

    // ------------------------------------------------------------------
    // 文件标签页：右键/双击「预览」把文件以只读预览展示进会话区的「预览」
    // tab（原生 conversation.view 槽位，与 对话/轨迹 同级）。
    // markdown/html/json/csv 有专属渲染器；图片预览；其余按纯文本。
    // 状态存模块级 store，切走 tab 再切回来内容不丢。
    // ------------------------------------------------------------------
    var FILES_TAB_LABEL = '预览'

    /** 当前活跃会话：list/read/download 携带给宿主，供围栏直查该会话 cwd。 */
    var activeSessionId = null

    /** 同时打开的预览 tab 上限：超过后挤掉最早打开的（FIFO）。 */
    var FILES_MAX_OPEN = 5

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
      setState({ files: Object.assign({}, state.files, patch) })
      try {
        var f = state.files
        window.__DFV_DBG = { n: f.list.length, active: f.active, ops: ((window.__DFV_DBG && window.__DFV_DBG.ops) || 0) + 1 }
      } catch (_) {}
    }

    function findFileEntry(path) {
      for (var i = 0; i < state.files.list.length; i++) {
        if (state.files.list[i].path === path) return state.files.list[i]
      }
      return null
    }

    /** 点击原生 header 的「预览」tab，把 view ring 切到预览视图。 */
    function activateFilesView() {
      try {
        var tabs = document.querySelectorAll('[role="tab"]')
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].textContent === FILES_TAB_LABEL) { tabs[i].click(); return true }
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
        }
        // FIFO：最多同时 5 个预览，新开的挤掉最早打开的
        var list = state.files.list.slice()
        while (list.length >= FILES_MAX_OPEN) list.shift()
        list.push(entry)
        setFiles({ list: list, active: path })
      } else if (entry.loaded) {
        setFiles({ active: path })
        activateFilesView()
        return
      } else {
        setFiles({ active: path })
      }
      activateFilesView()
      var res = await rpc('read', { path: path, sessionId: activeSessionId })
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 600) })
        res = await rpc('read', { path: path, sessionId: activeSessionId })
      }
      var cur = findFileEntry(path)
      if (!cur) return
      cur.loading = false
      if (!res || !res.ok) {
        cur.error = (res && res.error) || '读取失败'
      } else {
        cur.error = ''
        cur.loaded = true
        cur.kind = res.kind
        cur.size = res.size || 0
        if (res.kind === 'text') { cur.content = res.content; cur.truncated = !!res.truncated }
        else if (res.kind === 'image') { cur.dataUrl = 'data:' + res.mime + ';base64,' + res.data }
        else if (res.kind === 'pdf') { cur.data = res.data }
      }
      setFiles({ list: state.files.list.slice(), active: path })
    }

    async function reloadFile(path) {
      var entry = findFileEntry(path)
      if (!entry) return
      // 复位 loaded，让 openFileInTab 走重读路径而不是「已打开直接激活」。
      entry.loaded = false
      await openFileInTab(path)
    }

    function closeFileTab(path) {
      var list = state.files.list
      var idx = -1
      for (var i = 0; i < list.length; i++) if (list[i].path === path) { idx = i; break }
      if (idx < 0) return
      var next = list.slice(0, idx).concat(list.slice(idx + 1))
      var active = state.files.active
      if (active === path) {
        var neighbor = next[Math.min(idx, next.length - 1)]
        active = neighbor ? neighbor.path : null
      }
      setFiles({ list: next, active: active })
    }

    function setActiveFile(path) {
      setFiles({ active: path })
    }

    function NameInput(props) {
      var initial = props.initial
      var selectBase = props.selectBase !== false
      var onCommit = props.onCommit
      var onCancel = props.onCancel
      var valState = React.useState(initial)
      var val = valState[0]
      var setVal = valState[1]
      var settled = React.useRef(false)
      var inputRef = React.useRef(null)
      React.useEffect(function () {
        var el = inputRef.current
        if (!el) return
        el.focus()
        if (selectBase) {
          var dot = initial.lastIndexOf('.')
          if (dot <= 0) el.select(); else el.setSelectionRange(0, dot)
        } else {
          el.select()
        }
      }, [])
      function settle(fn) { if (settled.current) return; settled.current = true; fn() }
      return create('input', {
        ref: inputRef,
        type: 'text',
        value: val,
        spellCheck: false,
        autoComplete: 'off',
        className: 'expl-inline-input',
        onChange: function (e) { setVal(e.target.value) },
        onClick: function (e) { e.stopPropagation() },
        onBlur: function () { settle(function () { onCommit(val) }) },
        onKeyDown: function (e) {
          if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); settle(function () { onCommit(val) }) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(function () { onCancel() }) }
        },
      })
    }

    function Row(props) {
      var node = props.node
      var depth = props.depth
      var isDir = node.type === 'directory'
      var isSelected = state.selected.has(node.path)
      var isRenaming = state.renaming === node.path
      var isDropTarget = state.dropTarget === node.path
      visibleRows.push(node.path)

      var rowMain = create('div', {
        className: 'expl-row-main' + (isSelected ? ' selected' : '') + (isDropTarget ? ' drop-target' : ''),
        'data-path': node.path,
        style: { paddingLeft: 8 + depth * 16 },
        draggable: true,
        onClick: function (e) { onRowClick(e, node) },
        onDoubleClick: function () { onRowDoubleClick(node) },
        onContextMenu: function (e) { onRowContext(e, node) },
        onDragStart: function (e) { onDragStart(e, node) },
        onDragOver: function (e) { if (isDir) { e.preventDefault(); e.stopPropagation(); if (state.dropTarget !== node.path) setState({ dropTarget: node.path }) } },
        onDragLeave: function (e) { if (state.dropTarget === node.path) setState({ dropTarget: null }) },
        onDrop: function (e) { if (isDir) onRowDrop(e, node) },
      },
        create('span', {
          className: 'expl-caret' + (isDir ? ' expl-caret-big' : ' expl-caret-sm'),
          onClick: function (e) { if (isDir) { e.stopPropagation(); toggleNode(node) } },
        }, isDir ? (node.open ? '▾' : '▸') : '·'),
        create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: iconSvgFor(node) } }),
        isRenaming
          ? create(NameInput, {
              initial: node.name,
              selectBase: true,
              onCommit: function (name) { commitRename(node.path, name) },
              onCancel: function () { setState({ renaming: null }) },
            })
          : create('span', { className: 'expl-name' }, node.name),
        !isDir ? create('span', { className: 'expl-size' }, formatSize(node.size)) : null,
      )

      var children = []
      if (state.newItem && state.newItem.parent === node.path && isDir && node.open) {
        children.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 + (depth + 1) * 16 } },
            create('span', { className: 'expl-icon' }, state.newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(state.newItem.parent, name, state.newItem.isDir) },
              onCancel: function () { setState({ newItem: null }) },
            }),
          ),
        ))
      }
      if (isDir && node.open) {
        if (node.loading) {
          children.push(create('div', { key: '__loading__', className: 'expl-muted', style: { paddingLeft: 8 + (depth + 1) * 16 } }, '加载中…'))
        } else {
          ;(node.children || []).forEach(function (c) { children.push(create(Row, { key: c.path, node: c, depth: depth + 1 })) })
        }
      }

      return create('div', { key: node.path, className: 'expl-row' }, rowMain, children)
    }

    function buildMenuItems(node) {
      var items = []
      var multi = state.selected.size > 1
      if (node) {
        if (!multi) {
          if (node.type !== 'directory') {
            items.push({ key: 'open-tab', label: '👁 预览', onClick: function () { openFileInTab(node.path) } })
            items.push({ key: 'open', label: '🖥 用系统打开', onClick: openSelection, separatorAfter: true })
          } else {
            items.push({ key: 'open', label: '🖥 用系统打开', onClick: openSelection, separatorAfter: true })
          }
          items.push({ key: 'rename', label: '✎ 重命名', onClick: function () { startRename(node) } })
          items.push({ key: 'trash', label: '🗑 移到废纸篓', danger: true, onClick: trashSelection, separatorAfter: true })
        } else {
          items.push({ key: 'trash', label: '🗑 移到废纸篓 (' + state.selected.size + ' 项)', danger: true, onClick: trashSelection, separatorAfter: true })
        }
        if (node.type === 'directory') {
          items.push({ key: 'newfile', label: '📄 新建文件', onClick: function () { startNew(node.path, false) } })
          items.push({ key: 'newfolder', label: '📁 新建文件夹', onClick: function () { startNew(node.path, true) }, separatorAfter: true })
        }
        items.push({ key: 'copy', label: '⧉ 复制路径', onClick: function () { copyPath(node) } })
        if (node.type !== 'directory') {
          items.push({ key: 'download', label: '⬇ 下载', onClick: function () { downloadFile(node.path) } })
        }
      } else {
        items.push({ key: 'newfile', label: '📄 新建文件', onClick: function () { startNew(state.cwd, false) } })
        items.push({ key: 'newfolder', label: '📁 新建文件夹', onClick: function () { startNew(state.cwd, true) } })
        items.push({ key: 'refresh', label: '⟳ 刷新', onClick: refresh, separatorAfter: true })
        if (state.selected.size > 0) items.push({ key: 'none', label: '取消选择', onClick: function () { setState({ selected: new Set(), lastIndex: null }) } })
      }
      return items
    }

    function Menu(props) {
      var menu = props.menu
      var menuRef = React.useRef(null)
      var posState = React.useState({ x: menu.x, y: menu.y })
      var pos = posState[0]
      var setPos = posState[1]
      React.useEffect(function () {
        var el = menuRef.current
        if (!el) return
        var rect = el.getBoundingClientRect()
        var margin = 6
        var nx = menu.x
        var ny = menu.y
        if (menu.x + rect.width > window.innerWidth - margin) nx = Math.max(margin, window.innerWidth - rect.width - margin)
        if (menu.y + rect.height > window.innerHeight - margin) ny = Math.max(margin, window.innerHeight - rect.height - margin)
        setPos({ x: nx, y: ny })
      }, [menu.x, menu.y])
      React.useEffect(function () {
        if (typeof document === 'undefined') return
        function down(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setState({ menu: null }) }
        function key(e) { if (e.key === 'Escape') setState({ menu: null }) }
        document.addEventListener('mousedown', down)
        document.addEventListener('keydown', key)
        return function () {
          document.removeEventListener('mousedown', down)
          document.removeEventListener('keydown', key)
        }
      }, [])

      var items = buildMenuItems(menu.node)
      var menuChildren = []
      items.forEach(function (it) {
        menuChildren.push(create('button', {
          key: it.key,
          className: 'expl-menu-item' + (it.danger ? ' expl-danger' : ''),
          onClick: function () { setState({ menu: null }); it.onClick() },
        }, it.label))
        if (it.separatorAfter) menuChildren.push(create('div', { key: it.key + '-sep', className: 'expl-menu-sep' }))
      })
      return create('div', { ref: menuRef, className: 'expl-menu', style: { left: pos.x, top: pos.y } }, menuChildren)
    }

    // ------------------------------------------------------------------
    // 文件视图（conversation.view 'dsh-soup-files'）：
    // 子 tab 条 + 只读预览区（markdown/html/json/csv 渲染 / 图片预览 / 二进制提示）。
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // 预览渲染器：按扩展名分派（信任模型参考 JupyterLab viewer——
    // markdown 走不可信安全渲染管线，html 进无 allow-* 的沙箱 iframe）。
    // ------------------------------------------------------------------
    /** 取路径小写扩展名。 */
    function extOfName(p) {
      var m = /\.([A-Za-z0-9]+)$/.exec(String(p || ''))
      return m ? m[1].toLowerCase() : ''
    }

    /** 预览渲染器类型：markdown | html | json | csv | tsv | notebook | code | text。 */
    function previewKind(path) {
      var ext = extOfName(path)
      if (ext === 'md' || ext === 'markdown') return 'markdown'
      if (ext === 'html' || ext === 'htm') return 'html'
      if (ext === 'json') return 'json'
      if (ext === 'ipynb') return 'notebook'
      if (ext === 'csv') return 'csv'
      if (ext === 'tsv') return 'tsv'
      return 'text'
    }

    // 扩展名 → Shiki 语言提示。对齐 DSH 读卡片的 LANG_BY_EXTENSION
    // （packages/fs/tool-fs read-render.ts），json/md/markdown/html/htm 除外——
    // 它们走上方专属渲染器。
    var CODE_LANG_BY_EXT = {
      ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
      js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
      jsonc: 'json',
      py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
      c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
      cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
      sh: 'sh', bash: 'sh', zsh: 'sh',
      yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
      mdx: 'mdx', css: 'css', scss: 'scss', less: 'less',
      sql: 'sql', xml: 'xml', lua: 'lua',
    }

    /** 超过该字符数的代码文件不做高亮（Shiki 首次高亮的耗时保护）。 */
    var CODE_HIGHLIGHT_MAX_CHARS = 400000

    /** RFC 4180 风格的分隔符解析（引号感知，"" 转义），返回行数组。 */
    function parseDelimited(text, delim) {
      var rows = []
      var row = []
      var field = ''
      var inQuotes = false
      var n = text.length
      for (var i = 0; i < n; i++) {
        var ch = text[i]
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
          } else {
            field += ch
          }
        } else if (ch === '"') {
          inQuotes = true
        } else if (ch === delim) {
          row.push(field); field = ''
        } else if (ch === '\n') {
          row.push(field); rows.push(row); row = []; field = ''
        } else if (ch !== '\r') {
          field += ch
        }
      }
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
      return rows
    }

    /** 把 pretty JSON 切成着色 token 数组（纯文本/React 节点，无 innerHTML）。 */
    function jsonColorNodes(pretty) {
      var out = []
      var last = 0
      var re = /("(?:\\.|[^"\\])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
      var m
      while ((m = re.exec(pretty)) !== null) {
        if (m.index > last) out.push(pretty.slice(last, m.index))
        if (m[1] !== undefined) {
          out.push(create('span', { key: out.length, className: m[2] ? 'dfv-tok-key' : 'dfv-tok-str' }, m[1]))
          if (m[2]) out.push(m[2])
        } else if (m[0] === 'true' || m[0] === 'false') {
          out.push(create('span', { key: out.length, className: 'dfv-tok-bool' }, m[0]))
        } else if (m[0] === 'null') {
          out.push(create('span', { key: out.length, className: 'dfv-tok-null' }, m[0]))
        } else {
          out.push(create('span', { key: out.length, className: 'dfv-tok-num' }, m[0]))
        }
        last = re.lastIndex
      }
      if (last < pretty.length) out.push(pretty.slice(last))
      return out
    }

    var CSV_MAX_ROWS = 500
    var CSV_MAX_COLS = 64

    // ------------------------------------------------------------------
    // Markdown 相对图片 → dsh-soup 同源 img 端点绝对 URL。
    // 预览 markdown 时，DSH 的 MarkdownText 渲染器「禁相对链接/相对资源」，
    // `![x](view.jpg)` 这类相对路径图片会被直接丢弃。因此把 src 改写成
    // 本插件同名端点（GET /api/dsh-soup/img）的同源绝对地址，交给 <img>
    // 从磁盘内联加载。绝对（http/https/data 等）与根相对路径放行不处理。
    // ------------------------------------------------------------------
    var MD_IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
    function posixResolve(dir, rel) {
      var combined = (String(dir || '/').replace(/\/+$/, '') || '/') + '/' + String(rel)
      var out = []
      combined.split('/').forEach(function (seg) {
        if (seg === '' || seg === '.') return
        if (seg === '..') { if (out.length) out.pop(); return }
        out.push(seg)
      })
      return '/' + out.join('/')
    }
    function imgUrl(absPath) {
      return hostBase() + '/api/dsh-soup/img?p=' + encodeURIComponent(absPath)
    }
    function absolutizeMarkdownImages(text, baseDir) {
      if (!text) return text
      var dir = baseDir || '/'
      return text.replace(MD_IMG_RE, function (m0, alt, src) {
        var s = String(src || '').trim()
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(s)) return m0
        return '![' + alt + '](' + imgUrl(posixResolve(dir, s)) + ')'
      })
    }

    function MarkdownPreview(props) {
      var text = props.text
      if (MarkdownText) {
        var md = props.baseDir ? absolutizeMarkdownImages(text, props.baseDir) : text
        return create('div', { className: 'dfv-md-wrap' },
          create('div', { className: 'dfv-md' }, create(MarkdownText, { text: md })))
      }
      // 回退：宿主缺 ui-primitives 时按纯文本展示
      return create('pre', { className: 'dfv-code' }, text)
    }

    function HtmlPreview(props) {
      // 可交互预览：给 allow-scripts/popups/forms/modals（对齐 JupyterLab
      // trusted 档），但坚持不给 allow-same-origin——脚本跑在 opaque origin，
      // 触不到 GUI 的 DOM/存储/Cookie；srcdoc 注入 + no-referrer 收敛外链。
      return create('iframe', {
        className: 'dfv-frame',
        sandbox: 'allow-scripts allow-popups allow-forms allow-modals',
        referrerPolicy: 'no-referrer',
        title: props.title || 'HTML 预览',
        srcDoc: props.text,
      })
    }

    function PdfPreview(props) {
      // 对齐 JupyterLab pdf-extension：base64 → Blob → objectURL → 原生查看器
      // 嵌入（object 标签）。不加 sandbox——渲染方是浏览器自带的受信 PDF 查看器。
      var st = React.useState({ url: null, error: '' })
      var state = st[0]
      var setSt = st[1]
      React.useEffect(function () {
        var cancelled = false
        var made = null
        fetch('data:application/pdf;base64,' + props.data)
          .then(function (r) { return r.blob() })
          .then(function (blob) {
            if (cancelled) { URL.revokeObjectURL(made); return }
            made = URL.createObjectURL(blob)
            setSt({ url: made, error: '' })
          })
          .catch(function (e) {
            if (!cancelled) setSt({ url: null, error: String((e && e.message) || e) })
          })
        return function () {
          cancelled = true
          if (made) URL.revokeObjectURL(made)
        }
      }, [props.data])
      if (state.error) return create('div', { className: 'dfv-error' }, 'PDF 预览失败: ' + state.error)
      if (!state.url) return create('div', { className: 'dfv-empty' }, 'PDF 加载中…')
      return create('object', {
        className: 'dfv-frame dfv-pdf',
        type: 'application/pdf',
        data: state.url,
        'aria-label': 'PDF 预览',
      }, '当前浏览器无法内嵌预览 PDF，请右键用系统打开。')
    }

    // ------------------------------------------------------------------
    // Notebook（.ipynb）静态预览，GitHub 风格：markdown 单元走 MarkdownText，
    // 代码单元走 CodeBlock；输出按 MIME 择优渲染（image > html > md > text）。
    // 输出 HTML 与文件 HTML 同规——无 allow-* 沙箱 iframe 禁脚本防注入。
    // ------------------------------------------------------------------
    /** notebook 的 source 字段是 string 或行数组，统一成字符串。 */
    function nbSource(src) {
      return Array.isArray(src) ? src.join('') : String(src == null ? '' : src)
    }

    /** 剥离 traceback 里的 ANSI 转义序列。 */
    function stripAnsi(s) {
      return String(s == null ? '' : s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    }

    var NB_MIME_PREF = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'text/html', 'text/markdown', 'text/latex', 'text/plain']

    function nbPickMime(data) {
      if (!data) return null
      for (var i = 0; i < NB_MIME_PREF.length; i++) {
        if (Object.prototype.hasOwnProperty.call(data, NB_MIME_PREF[i])) return NB_MIME_PREF[i]
      }
      return null
    }

    /** 内核语言名 → Shiki 提示；未知语言由 CodeBlock 自动回退纯文本。 */
    var NB_LANG_HINT = { python: 'py', r: 'r', julia: 'julia', javascript: 'js', typescript: 'ts', bash: 'sh', ruby: 'rb' }

    function NbOutput(props) {
      var out = props.out
      var t = out && out.output_type
      if (t === 'stream') {
        return create('pre', { className: 'dfv-nb-out' + (out.name === 'stderr' ? ' dfv-nb-out-err' : '') }, nbSource(out.text))
      }
      if (t === 'error') {
        var tb = (Array.isArray(out.traceback) ? out.traceback : []).map(stripAnsi).join('\n')
        return create('div', { className: 'dfv-nb-error' },
          create('div', { className: 'dfv-nb-error-head' }, stripAnsi(out.ename) + ': ' + stripAnsi(out.evalue)),
          tb ? create('pre', { className: 'dfv-nb-trace' }, tb) : null)
      }
      if (t === 'execute_result' || t === 'display_data') {
        var mime = nbPickMime(out.data)
        if (!mime) return null
        if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
          return create('img', { className: 'dfv-nb-img', src: 'data:' + mime + ';base64,' + out.data[mime], alt: 'notebook output image' })
        }
        if (mime === 'image/svg+xml') {
          return create('img', { className: 'dfv-nb-img', src: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(nbSource(out.data[mime])))), alt: 'notebook output svg' })
        }
        if (mime === 'text/html') {
          return create('iframe', { className: 'dfv-nb-html', sandbox: '', title: 'HTML 输出', srcDoc: nbSource(out.data[mime]) })
        }
        if (mime === 'text/markdown' && MarkdownText) {
          return create('div', { className: 'dfv-md-wrap dfv-nb-md' }, create(MarkdownText, { text: nbSource(out.data[mime]) }))
        }
        var plain = Object.prototype.hasOwnProperty.call(out.data || {}, 'text/plain') ? out.data['text/plain'] : out.data[mime]
        return create('pre', { className: 'dfv-nb-out' }, nbSource(plain))
      }
      return null
    }

    function NotebookPreview(props) {
      var nb = null
      try { nb = JSON.parse(props.text) } catch (err) { nb = undefined }
      if (nb === undefined || typeof nb !== 'object' || nb === null) {
        return create(React.Fragment, null,
          create('div', { className: 'dfv-cap' }, 'ipynb 解析失败，按纯文本显示'),
          create('pre', { className: 'dfv-code' }, props.text))
      }
      var cells = Array.isArray(nb.cells) ? nb.cells : []
      if (!cells.length && Array.isArray(nb.worksheets)) {
        // nbformat v3：worksheets[].cells 扁平合并
        for (var w = 0; w < nb.worksheets.length; w++) {
          cells = cells.concat(Array.isArray(nb.worksheets[w].cells) ? nb.worksheets[w].cells : [])
        }
      }
      var ks = nb.metadata && nb.metadata.kernelspec
      var kernelName = (ks && (ks.display_name || ks.name)) || ''
      var langName = nb.metadata && nb.metadata.language_info && nb.metadata.language_info.name
      var codeLang = (langName && Object.prototype.hasOwnProperty.call(NB_LANG_HINT, String(langName).toLowerCase()))
        ? NB_LANG_HINT[String(langName).toLowerCase()]
        : undefined

      var cellEls = cells.map(function (cell, i) {
        var ct = cell.cell_type
        var body = null
        if (ct === 'code') {
          var outputs = (Array.isArray(cell.outputs) ? cell.outputs : []).map(function (o, j) {
            return create(NbOutput, { key: j, out: o })
          })
          var codeSrc = nbSource(cell.source)
          body = create('div', { className: 'dfv-nb-cellbody' },
            CodeBlock
              ? create(CodeBlock, { code: codeSrc, lang: codeLang })
              : create('pre', { className: 'dfv-code' }, codeSrc),
            outputs.length ? create('div', { className: 'dfv-nb-outputs' }, outputs) : null)
        } else if (ct === 'markdown') {
          body = MarkdownText
            ? create('div', { className: 'dfv-md-wrap dfv-nb-cellbody' }, create(MarkdownText, { text: nbSource(cell.source) }))
            : create('pre', { className: 'dfv-code dfv-nb-cellbody' }, nbSource(cell.source))
        } else {
          body = create('pre', { className: 'dfv-code dfv-nb-cellbody dfv-nb-raw' }, nbSource(cell.source))
        }
        var badge = ct === 'code'
          ? '[' + (cell.execution_count != null ? cell.execution_count : ' ') + ']'
          : ct === 'markdown' ? 'Md' : 'raw'
        return create('div', { key: i, className: 'dfv-nb-cell dfv-nb-' + ct },
          create('div', { className: 'dfv-nb-gutter' }, badge),
          body)
      })

      return create('div', { className: 'dfv-nb' },
        create('div', { className: 'dfv-cap' },
          'Jupyter Notebook' + (kernelName ? ' · ' + kernelName : '') + ' · ' + cells.length + ' 个单元格'),
        cellEls.length ? cellEls : create('div', { className: 'dfv-muted' }, '（空笔记本）'))
    }

    function JsonPreview(props) {
      var failed = false
      try { JSON.parse(props.text) } catch (err) { failed = true }
      if (failed) {
        return create(React.Fragment, null,
          create('div', { className: 'dfv-cap' }, 'JSON 解析失败，按纯文本显示'),
          create('pre', { className: 'dfv-code' }, props.text))
      }
      return create('pre', { className: 'dfv-json dfv-code' }, jsonColorNodes(JSON.stringify(JSON.parse(props.text), null, 2)))
    }

    function DelimitedPreview(props) {
      var delim = props.delim || ','
      var rows = parseDelimited(props.text, delim)
      var totalRows = rows.length
      // 首行作表头（数据导出的常见约定）
      var headerCells = totalRows > 0 ? rows[0].slice(0, CSV_MAX_COLS) : []
      var cols = headerCells.length
      for (var r = 1; r <= Math.min(totalRows - 1, CSV_MAX_ROWS); r++) {
        cols = Math.max(cols, Math.min(rows[r].length, CSV_MAX_COLS))
      }
      var caps = []
      if (totalRows > CSV_MAX_ROWS + 1) caps.push('共 ' + totalRows + ' 行，仅预览前 ' + CSV_MAX_ROWS + ' 行')
      var trs = []
      for (var ri = 1; ri <= Math.min(totalRows - 1, CSV_MAX_ROWS); ri++) {
        var cells = rows[ri]
        var tds = []
        for (var c = 0; c < cols; c++) {
          tds.push(create('td', { key: c, className: 'dfv-td' }, cells[c] != null ? String(cells[c]) : ''))
        }
        trs.push(create('tr', { key: ri }, tds))
      }
      return create(React.Fragment, null,
        caps.length ? create('div', { className: 'dfv-cap' }, caps.join('；')) : null,
        create('div', { className: 'dfv-table-wrap' },
          create('table', { className: 'dfv-table' },
            create('thead', null,
              create('tr', null, headerCells.map(function (cellText, ci) {
                return create('th', { key: ci, className: 'dfv-th' }, cellText != null ? String(cellText) : '')
              })),
            ),
            create('tbody', null, trs),
          ),
        ),
      )
    }

    function formatBytes(n) {
      if (typeof n !== 'number' || n < 0) return ''
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(1) + ' GB'
    }

    function FileContent(props) {
      var entry = props.entry
      if (entry.loading) {
        return create('div', { className: 'dfv-empty' }, '加载中…')
      }
      if (entry.error) {
        return create('div', { className: 'dfv-error' }, entry.error)
      }
      if (entry.kind === 'binary') {
        return create('div', { className: 'dfv-muted' },
          '二进制文件（' + formatBytes(entry.size) + '），请在资源管理器中用系统打开')
      }
      if (entry.kind === 'image-too-large') {
        return create('div', { className: 'dfv-muted' },
          '图片过大（' + formatBytes(entry.size) + '，上限 ' + formatBytes(entry.limit) + '）')
      }
      if (entry.kind === 'image') {
        return create('div', { className: 'dfv-image-wrap' },
          create('img', { className: 'dfv-image', src: entry.dataUrl, alt: entry.name }))
      }
      if (entry.kind === 'pdf-too-large') {
        return create('div', { className: 'dfv-muted' },
          'PDF 过大（' + formatBytes(entry.size) + '，上限 ' + formatBytes(entry.limit) + '），请用系统打开')
      }
      if (entry.kind === 'pdf') {
        return create(PdfPreview, { data: entry.data })
      }
      // 文本类：按扩展名选预览渲染器（纯只读，无编辑）
      var pk = previewKind(entry.path)
      var view = null
      if (pk === 'markdown') view = create(MarkdownPreview, { text: entry.content, baseDir: parentOf(entry.path) })
      else if (pk === 'html') view = create(HtmlPreview, { text: entry.content, title: entry.name })
      else if (pk === 'json') view = create(JsonPreview, { text: entry.content })
      else if (pk === 'notebook') view = create(NotebookPreview, { text: entry.content })
      else if (pk === 'csv' || pk === 'tsv') view = create(DelimitedPreview, { text: entry.content, delim: pk === 'tsv' ? '\t' : ',' })
      else {
        // 代码文件：DSH CodeBlock（Shiki 高亮，语法包懒加载）；无高亮条件回退纯文本
        var lang = Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, extOfName(entry.path))
          ? CODE_LANG_BY_EXT[extOfName(entry.path)]
          : undefined
        if (CodeBlock && lang && entry.content.length <= CODE_HIGHLIGHT_MAX_CHARS) {
          view = create('div', { className: 'dfv-code-wrap' }, create(CodeBlock, { code: entry.content, lang: lang }))
        } else {
          view = create('pre', { className: 'dfv-code' }, entry.content)
        }
      }
      return create(React.Fragment, null,
        entry.truncated ? create('div', { className: 'dfv-cap' },
          '文件超过 2 MB，仅预览前 2 MB；完整内容请用系统编辑器打开。') : null,
        view,
      )
    }

    function FilesView(props) {
      var s = useStore()
      var files = s.files
      var active = files.active ? findFileEntry(files.active) : null

      var tabs = files.list.map(function (entry) {
        return create('button', {
          key: entry.path,
          type: 'button',
          className: 'dfv-tab' + (files.active === entry.path ? ' active' : ''),
          title: entry.path,
          onClick: function () { setActiveFile(entry.path) },
        },
          create('span', { className: 'dfv-tab-name' }, entry.name),
          create('span', {
            className: 'dfv-close',
            role: 'button',
            title: '关闭',
            onClick: function (e) { e.stopPropagation(); closeFileTab(entry.path) },
          }, '✕'),
        )
      })

      var body = null
      if (!active) {
        body = create('div', { className: 'dfv-empty' },
          create('span', { style: { fontSize: 22 } }, '📄'),
          '在右侧资源管理器中双击或右键「预览」文件',
        )
      } else {
        body = create('div', { className: 'dfv-body' },
          create('div', { className: 'dfv-toolbar' },
            create('span', { className: 'dfv-toolbar-path', title: active.path }, active.path),
            typeof active.size === 'number' && active.size > 0 ? create('span', null, formatBytes(active.size)) : null,
            active.loaded ? create('button', {
              type: 'button',
              className: 'dfv-btn',
              title: '从磁盘重新读取（刷新预览）',
              onClick: function () { reloadFile(active.path) },
            },
              create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }),
              '重载',
            ) : null,
          ),
          create(FileContent, { key: active.path, entry: active }),
        )
      }

      return create('div', { className: 'dfv-root' },
        files.list.length > 0 ? create('div', { className: 'dfv-tabbar' }, tabs) : null,
        body,
      )
    }

    function findFrameEl(startEl) {
      var cur = startEl && startEl.parentElement
      while (cur) {
        try {
          var gtc = cur.style && cur.style.gridTemplateColumns
          if (gtc && gtc.indexOf('1fr') !== -1) return cur
        } catch (e) {}
        cur = cur.parentElement
      }
      return null
    }

    function setHeroDetailsWidth(startEl, width) {
      var frame = findFrameEl(startEl)
      if (!frame) return false
      try {
        var gtc = frame.style.gridTemplateColumns
        if (!gtc) return false
        var parts = gtc.trim().split(/\s+/)
        if (parts.length < 3) return false
        parts[parts.length - 1] = width + 'px'
        frame.style.gridTemplateColumns = parts.join(' ')
        return true
      } catch (e) {
        return false
      }
    }

    function Panel(props) {
      var s = useStore()
      var sessionId = props && props.sessionId
      // 客户端会话快照是本会话 cwd 的可信来源（与官方 DetailsPanel 同源，
      // 始终是当前会话所在项目目录，而非宿主启动时的根目录）。
      var useSessions = props && props.useSessions
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      var cwdRef = React.useRef(liveCwd)
      cwdRef.current = liveCwd || cwdRef.current
      var panelRef = React.useRef(null)
      var frameRef = React.useRef(null)
      var widthRef = React.useRef(DETAILS_DEFAULT)
      var dragRef = React.useRef({ startX: 0, startW: 0, active: false })

      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId])

      var setFrameWidth = React.useCallback(function (w) {
        var frame = frameRef.current
        if (!frame) return
        try {
          var gtc = frame.style.gridTemplateColumns
          if (!gtc) return
          var parts = gtc.trim().split(/\s+/)
          if (parts.length < 3) return
          parts[parts.length - 1] = Math.round(w) + 'px'
          frame.style.gridTemplateColumns = parts.join(' ')
        } catch (e) {}
      }, [])

      React.useEffect(function () {
        var el = panelRef.current
        if (!el) return
        var mo = null
        var cancelled = false
        function attach() {
          var frame = findFrameEl(el)
          if (!frame || mo) return
          frameRef.current = frame
          function sync() {
            try {
              var gtc = frame.style.gridTemplateColumns
              if (!gtc) return
              var parts = gtc.trim().split(/\s+/)
              if (parts.length < 3) return
              var last = parseFloat(parts[parts.length - 1])
              if (isNaN(last) || last <= 1) { setState({ open: false }); return }
              setState({ open: true })
              if (Math.round(last) !== Math.round(widthRef.current)) {
                parts[parts.length - 1] = Math.round(widthRef.current) + 'px'
                frame.style.gridTemplateColumns = parts.join(' ')
              }
            } catch (e) {}
          }
          mo = new MutationObserver(sync)
          mo.observe(frame, { attributes: true, attributeFilter: ['style'] })
          sync()
        }
        attach()
        if (!mo) {
          var tries = 0
          var t = setInterval(function () {
            if (cancelled || mo) { clearInterval(t); return }
            attach()
            if (++tries > 40) clearInterval(t)
          }, 100)
        }
        return function () { cancelled = true; if (mo) mo.disconnect() }
      }, [])

      function onResizeDown(e) {
        e.preventDefault()
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch (err) {}
        dragRef.current = { startX: e.clientX, startW: widthRef.current, active: true }
        if (frameRef.current) { try { frameRef.current.style.transition = 'none' } catch (e) {} }
      }
      function onResizeMove(e) {
        if (!dragRef.current.active) return
        var w = clampW(dragRef.current.startW - (e.clientX - dragRef.current.startX))
        widthRef.current = w
        setFrameWidth(w)
      }
      function onResizeUp(e) {
        dragRef.current.active = false
        try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (err) {}
        if (frameRef.current) { try { frameRef.current.style.transition = '' } catch (e) {} }
      }

      visibleRows.length = 0

      var bodyChildren = []
      if (state.newItem && state.newItem.parent === state.cwd) {
        bodyChildren.push(create('div', { key: '__new__', className: 'expl-row' },
          create('div', { className: 'expl-row-main', style: { paddingLeft: 8 } },
            create('span', { className: 'expl-icon' }, state.newItem.isDir ? '📁' : '📄'),
            create(NameInput, {
              initial: '',
              selectBase: false,
              onCommit: function (name) { commitNew(state.newItem.parent, name, state.newItem.isDir) },
              onCancel: function () { setState({ newItem: null }) },
            }),
          ),
        ))
      }
      if (s.tree.length === 0 && !(state.newItem && state.newItem.parent === state.cwd)) {
        bodyChildren.push(create('div', { key: '__empty__', className: 'expl-muted' }, '（空目录）'))
      } else {
        s.tree.forEach(function (node) { bodyChildren.push(create(Row, { key: node.path, node: node, depth: 0 })) })
      }

      var container = create('div', {
        className: 'expl-body' + (state.dropTarget === state.cwd ? ' drop-target' : ''),
        onClick: onBlankClick,
        onContextMenu: onBlankContext,
        onDragOver: function (e) { e.preventDefault(); e.stopPropagation(); if (state.dropTarget !== state.cwd) setState({ dropTarget: state.cwd }) },
        onDragLeave: function (e) { if (state.dropTarget === state.cwd) setState({ dropTarget: null }) },
        onDrop: onBodyDrop,
      }, bodyChildren)

      return create('div', { ref: panelRef, className: 'expl-panel' },
        create('div', { className: 'expl-resize', onPointerDown: onResizeDown, onPointerMove: onResizeMove, onPointerUp: onResizeUp, onPointerCancel: onResizeUp }),
        create('div', { className: 'expl-head' },
          create('span', { className: 'expl-title' }, '📁 资源管理器'),
          create('div', { className: 'expl-head-btns' },
            create('button', {
              className: 'expl-btn',
              onClick: function () { refreshAll() },
              title: '刷新（保持已展开目录）',
              'aria-label': '刷新',
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } })),
            create('button', {
              className: 'expl-btn',
              onClick: function () { if (uploadInputEl) uploadInputEl.click() },
              title: '上传文件',
              'aria-label': '上传文件',
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_UPLOAD } })),
            create('button', {
              className: 'expl-btn',
              onClick: function (event) {
                try { layout.closeDetails() } catch (e) {}
                setHeroDetailsWidth(event.currentTarget, 0)
              },
              title: '关闭',
              'aria-label': '关闭资源管理器',
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_CLOSE } })),
          ),
        ),
        create('div', { className: 'expl-path', title: s.cwd || '' }, s.cwd || '…'),
        (s.uploads && s.uploads.length) ? create('div', { className: 'expl-uploads' },
          s.uploads.map(function (u, i) {
            var pct = u.done ? null : (u.total ? Math.round((u.loaded / u.total) * 100) : 0)
            return create('div', { key: i, className: 'expl-upload-row' + (u.done ? ' expl-upload-done' : '') },
              create('span', { className: 'expl-upload-glyph' }, u.done ? '✓' : (u.down ? '⬇' : '⬆')),
              create('span', { className: 'expl-upload-text' },
                u.done ? u.name
                  : (u.down ? '下载中 ' : '上传中 ') + (u.totalFiles > 1 ? '(' + u.idx + '/' + u.totalFiles + ') ' : '') + u.name,
              ),
              !u.done && u.total ? create('span', { className: 'expl-upload-pct' }, pct + '%') : null,
            )
          }),
        ) : null,
        create('input', { type: 'file', multiple: true, style: { display: 'none' }, ref: function (el) { uploadInputEl = el }, onChange: onUploadPicker }),
        s.error ? create('div', { className: 'expl-error' }, s.error) : null,
        s.notice ? create('div', { className: 'expl-notice' }, s.notice) : null,
        s.selected.size > 1
          ? create('div', { className: 'expl-bulk' }, '已选 ' + s.selected.size + ' 项 · 拖到文件夹可移动')
          : null,
        container,
        s.menu ? create('div', { className: 'expl-menu-mask', onMouseDown: function () { setState({ menu: null }) }, onContextMenu: function (e) { e.preventDefault(); setState({ menu: null }) } }) : null,
        s.menu ? create(Menu, { menu: s.menu }) : null,
      )
    }

    function HeaderAction(props) {
      var s = useStore()
      var sessionId = props && props.sessionId
      var useSessions = props && props.useSessions
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      var cwdRef = React.useRef(liveCwd)
      cwdRef.current = liveCwd || cwdRef.current
      React.useEffect(function () { trackSession(sessionId, cwdRef.current) }, [sessionId])
      return create('button', {
        type: 'button',
        className: 'expl-toggle expl-tool' + (s.open ? ' expl-active' : ''),
        onClick: function () { try { if (s.open) layout.closeDetails(); else layout.openDetails() } catch (e) {} },
        title: '项目资源管理器',
        'aria-label': '项目资源管理器',
      }, '📁')
    }

    function HeroAction(props) {
      var s = useStore()
      var session = props && props.session
      var useSessions = props && props.useSessions
      var liveCwd = useSessions ? useSessions(function (list) {
        return (props.sessionId && list.byId[props.sessionId]) ? list.byId[props.sessionId].cwd : undefined
      }) : undefined
      var blank = !!(session && session.blank && session.composerPhase === 'blank')
      React.useEffect(function () {
        if (blank) trackSession(props.sessionId, liveCwd)
      }, [blank, props.sessionId])
      if (!blank) return null
      return create('div', { className: 'expl-hero-dock' },
        create('button', {
          type: 'button',
          className: 'expl-toggle expl-tool' + (s.open ? ' expl-active' : ''),
          onClick: function (event) {
            if (s.open) {
              try { layout.closeDetails() } catch (e) {}
              setHeroDetailsWidth(event.currentTarget, 0)
            } else if (!setHeroDetailsWidth(event.currentTarget, DETAILS_DEFAULT)) {
              try { layout.openDetails() } catch (e) {}
            }
          },
          title: '项目资源管理器',
          'aria-label': '项目资源管理器',
        }, '📁'))
    }

    // ------------------------------------------------------------------
    // 速度徽标：DOM 注入到 Deep diving（role=status）旁。
    // 不改 DSH 源码。用 MutationObserver 定位消息流里的 Deep diving，
    // 把徽标节点 append 进其行内（inline-flex 同行），实现永远紧贴。
    // ------------------------------------------------------------------
    // 模块级 timer 引用：apply(ctx) 里赋值（与 dsh-soup 现有 layout 同款模式）
    var timerRef = null

    function SpeedBadge(props) {
      var sessionId = props && (props.sessionId || (props.session && props.session.id))

      // 持有最新状态的最新值的 ref（供 MutationObserver 回调读取）
      var statusRef = React.useRef(null)
      var dotsRef = React.useRef(1)
      var badgeElRef = React.useRef(null)
      // hostRef：当前挂载的 Deep diving 宿主元素（observer 找到后持有）
      var hostRef = React.useRef(null)

      // 省略号循环
      React.useEffect(function () {
        if (!timerRef) return
        var stop = timerRef.interval(function () {
          dotsRef.current = dotsRef.current >= 3 ? 1 : dotsRef.current + 1
          if (hostRef.current) renderBadge()
        }, 400)
        return function () { stop() }
      }, [])

      // 速度轮询
      React.useEffect(function () {
        if (!sessionId || !timerRef) return
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
          el.textContent = '正在等待模型' + new Array(dotsRef.current + 1).join('.')
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
            if (candidates[i].textContent && candidates[i].textContent.indexOf('Deep diving') !== -1) return candidates[i]
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

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // GoalBar 多行版：复用 DSH 原生 GoalBar 的 goal projection 与动作动词
    // （onEdit/onPause/onResume/onClear），仅在展示上把单行截断放开为多行、
    // 编辑用 textarea。通过 conversation.input.dock 同 id 'goal' + 更低 priority
    // (-1 < 0) 遮蔽默认实现，不改 DSH 源码，工具与数据仍走原生 goal。
    // ------------------------------------------------------------------
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
            var err = result && result.error ? (result.error.message + ' (' + result.error.code + ')') : '操作失败'
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

    /** 应用浏览器半区：注册会话头部/空白会话切换按钮、details 右列面板、GoalBar、速度徽标。 */
    function apply(ctx) {
      var slots = ctx.slots
      layout = ctx.layout
      timerRef = ctx.timer
      var sessions = ctx.sessions
      var remoteGoals = ctx.remote.goals
      var disposers = []
      // 自动刷新心跳：1s 固定心跳 + 到期才探测（基础 3s；宿主不可达时指数退避，封顶 60s）。
      // 面板关且无预览时 tick 内直接返回（零请求）；首个 tick 只建基线。
      if (timerRef && typeof timerRef.interval === 'function') {
        var stopAuto = timerRef.interval(function () { autoHeartbeat() }, AUTO_HEARTBEAT_MS)
        disposers.push(function () { try { stopAuto() } catch (e) {} })
      }
      slots.inject('conversation.session.header.utilities', function () {
        disposers.push(slots.register(
          { name: 'conversation.session.header.utilities', id: 'dsh-soup-toggle', order: 10, label: '资源管理器' },
          function (props) { return create(HeaderAction, props) },
        ))
      })
      slots.inject('details', function () {
        disposers.push(slots.register(
          // `details` is a single slot occupied by the shell at priority 0.
          // Lower priorities render first, so this intentionally shadows it.
          { name: 'details', priority: -1 },
          function (props) { return create(Panel, props) },
        ))
      })
      // 文件标签页：与 对话/轨迹 同级的原生 view tab（ui-trajectory 同款注册方式）。
      // 槽位 entry 是静态的，多文件由 FilesView 内部子 tab 条管理。
      slots.inject('conversation.view', function () {
        disposers.push(slots.register(
          { name: 'conversation.view', id: 'dsh-soup-files', order: 20, label: FILES_TAB_LABEL },
          function (props) { return create(FilesView, props) },
        ))
      })
      // 从 goal projection 读取当前 CAS ref（与原生 GoalBar 同款逻辑）。
      function refOf(sessionId) {
        try {
          var binding = sessions.binding(sessionId)
          var face = binding && binding.session && binding.session.projections && binding.session.projections.faceOf('goal')
          var snapshot = face && face.getSnapshot()
          if (snapshot && snapshot.goal) return { id: snapshot.goal.id, revision: snapshot.goal.revision }
        } catch (e) { /* ignore */ }
        return undefined
      }
      var noCurrentGoal = {
        ok: false,
        error: { code: 'no-current-goal', message: 'no current goal to mutate', details: {} },
      }
      slots.inject('conversation.input.dock', function () {
        disposers.push(slots.register(
          { name: 'conversation.input.dock', id: 'dsh-soup-hero-toggle', order: -10 },
          function (props) { return create(HeroAction, props) },
        ))
        // GoalBar 多行版：同 id 'goal'、更低 priority (-1) -> 遮蔽默认单行实现。
        // inject 提供 onEdit/onPause/onResume/onClear 动作动词（与原生 GoalBar 一致）。
        disposers.push(slots.register(
          {
            name: 'conversation.input.dock', id: 'goal', order: 10, priority: -1, locale: 'goal',
            inject: function (sessionId) {
              return {
                onEdit: function (objective) {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.edit(sessionId, ref, { objective: objective })
                },
                onPause: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.pause(sessionId, ref)
                },
                onResume: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.resume(sessionId, ref)
                },
                onClear: function () {
                  var ref = refOf(sessionId)
                  if (ref === undefined) return Promise.resolve(noCurrentGoal)
                  return remoteGoals.clear(sessionId, ref)
                },
              }
            },
          },
          function (props) { return create(GoalDock, props) },
        ))
        disposers.push(slots.register(
          { name: 'conversation.input.dock', id: 'dsh-speed-badge', order: 30, label: '速度徽标' },
          function (props) { return create(SpeedBadge, props) },
        ))
      })
      ctx.effect(
        function () { return function () { disposers.forEach(function (d) { try { d() } catch (e) {} }) } },
        'dsh-soup: explorer toggles + details panel + speed badge',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
