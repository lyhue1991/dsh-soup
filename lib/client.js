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
      '.expl-btn{width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--dsw-alias-label-secondary);font-size:15px;cursor:pointer;padding:0;border-radius:8px;flex:none;}' +
      '.expl-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.expl-btn svg{width:16px;height:16px;display:block;}' +
      '.expl-path{font-size:11px;color:var(--dsw-alias-label-secondary);padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;unicode-bidi:plaintext;flex:none;cursor:default;}' +
      '.expl-error{color:var(--dsw-alias-state-error-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-notice{color:var(--dsw-alias-state-success-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-bulk{color:var(--dsw-alias-state-business-primary);padding:6px 14px;font-size:12px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.expl-body{overflow:auto;flex:1;padding:6px 0 12px;}' +
      '.expl-row-main{display:flex;align-items:center;gap:4px;padding-top:2px;padding-bottom:2px;padding-right:10px;cursor:pointer;border-radius:8px;margin:0 4px;height:40px;box-sizing:border-box;user-select:none;}' +
      '.expl-row-main{position:relative;}' +
      '.expl-row-main:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.expl-row-main.selected{background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-row-main.drop-target,.expl-body.drop-target{outline:1px dashed var(--dsw-alias-state-business-primary);outline-offset:-2px;background:var(--dsw-alias-interactive-bg-hover-accent);}' +
      '.expl-caret{flex:none;cursor:pointer;line-height:1;}' +
      /* Keep a compact reserved disclosure slot for nested rows; folder icons
         remain visible while expansion is driven by row/double-click actions. */
      '.expl-caret-big{width:2px;height:16px;font-size:0;color:transparent;display:flex;align-items:center;justify-content:center;}' +
      '.expl-caret-big::before{content:"";display:block;width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:6px solid var(--dsw-alias-label-secondary);transition:transform 150ms var(--ds-ease-in-out);}' +
      '.expl-caret-big.open::before{transform:rotate(90deg);}' +
      '.expl-caret-sm{width:2px;height:16px;font-size:0;color:transparent;display:flex;align-items:center;justify-content:center;pointer-events:none;}' +
      '.expl-row-main .expl-caret-big{display:flex;visibility:hidden;}' +
      '.expl-caret-root{position:absolute;left:8px;top:50%;transform:translateY(-50%);z-index:1;}' +
      '.expl-caret-root.open::before{transform:rotate(90deg);}' +
      '.expl-icon{flex:none;display:flex;align-items:center;}.expl-icon svg{width:16px;height:16px;display:block;}' +
      '.expl-uploads{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);padding:5px 14px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-specific-tip);}' +
      '.expl-upload-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);}' +
      '.expl-upload-done{color:var(--dsw-alias-state-success-primary);}' +
      '.expl-upload-pct{margin-left:auto;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-caption);}' +
      '.expl-upload-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.expl-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);}' +
      '.expl-row-more{display:none;flex:none;width:28px;height:28px;align-items:center;justify-content:center;border:0;border-radius:6px;padding:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}' +
      '.expl-row-main:hover .expl-row-more,.expl-row-main.selected .expl-row-more{display:inline-flex;}' +
      '.expl-row-more:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      '.expl-row-more svg{width:16px;height:16px;display:block;}' +
      '.expl-size{color:var(--dsw-alias-label-tertiary);font-size:11px;flex:none;margin-left:8px;}' +
      '.expl-muted{color:var(--dsw-alias-label-tertiary);padding:4px 14px;font-size:12px;}' +
      '.expl-menu-mask{position:fixed;inset:0;z-index:1980;}' +
      '.expl-menu{position:fixed;z-index:1990;min-width:172px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;padding:4px;box-shadow:var(--dsw-shadow-lv3);pointer-events:auto;}' +
      '.expl-menu-item{display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:transparent;border:none;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 10px;border-radius:8px;cursor:pointer;line-height:1.4;}' +
      '.expl-menu-ico{flex:none;display:inline-flex;align-items:center;}.expl-menu-ico svg{width:14px;height:14px;display:block;}' +
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
    // 注意：只引入刷新图标——ICON_CLOSE / ICON_UPLOAD 与 GoalBar 段的
    // 同名 React 元素常量冲突（var 提升覆盖），字符样式反而更稳。
    // ------------------------------------------------------------------
    var ICON_REFRESH = '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 18 18"><path fill="currentColor" d="M9 13.5c-2.49 0-4.5-2.01-4.5-4.5S6.51 4.5 9 4.5c1.24 0 2.36.52 3.17 1.33L10 8h5V3l-1.76 1.76A6 6 0 0 0 9 3C5.69 3 3.01 5.69 3.01 9S5.69 15 9 15a5.98 5.98 0 0 0 5.9-5h-1.52c-.46 2-2.24 3.5-4.38 3.5"/></svg>'
    var ICON_MORE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="13" cy="8" r="1.3" fill="currentColor"/></svg>'
    var EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
    var SHRINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'

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
      '.dfv-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);user-select:text;-webkit-user-select:text;}' +
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
      '.dfv-toolbar-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;unicode-bidi:plaintext;font-family:var(--ds-font-family-code);}' +
      '.dfv-btn{flex:none;display:inline-flex;align-items:center;gap:5px;height:26px;box-sizing:border-box;background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;padding:0 10px;border-radius:7px;cursor:pointer;}' +
      '.dfv-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}' +
      '.dfv-btn svg{width:14px;height:14px;display:block;flex:none;}' +
      '.dfv-error{padding:8px 14px;font-size:12px;color:var(--dsw-alias-state-error-primary);flex:none;}' +
      '.dfv-muted{padding:24px 14px;font-size:13px;color:var(--dsw-alias-label-tertiary);text-align:center;}' +
      '.dfv-cap{padding:5px 14px;font-size:11px;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.dfv-code{flex:1;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;overflow:auto;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55;white-space:pre;tab-size:2;user-select:text;}' +
      '.dfv-code-wrap{flex:1;min-height:0;overflow:auto;padding:8px 10px;}' +
      '.dfv-code-lines{flex:1;min-height:0;display:flex;overflow:auto;}' +
      '.dfv-code-gutter{position:sticky;left:0;z-index:1;flex:none;padding:10px 8px 10px 12px;text-align:right;color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55;user-select:none;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);}' +
      '.dfv-code-main{flex:1;min-width:0;}' +
      '.dfv-code-main .dfv-code{overflow:visible;width:auto;}' +
      // CodeBlock（md-code-block）在行号布局内的适配：
      // 隐藏 banner（js 标签 + 复制按钮），统一 padding/字体与 gutter 对齐。
      '.dfv-code-main .md-code-block{margin:0;border-radius:0;background:transparent;}' +
      '.dfv-code-main .md-code-block>div:first-child{display:none!important;}' +
      '.dfv-code-main .md-code-block pre{padding:10px 14px!important;margin:0!important;font:12.5px/1.55 var(--ds-font-family-code)!important;background:transparent!important;border-radius:0!important;white-space:pre;word-break:normal;}' +
      '.dfv-nb{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);}' +
      '.dfv-nb-cell{display:flex;border-bottom:1px solid var(--dsw-alias-border-l1);}' +
      '.dfv-nb-gutter{flex:none;width:44px;padding:8px 6px;text-align:right;font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-caption);border-right:1px solid var(--dsw-alias-border-l1);user-select:none;background:var(--dsw-specific-sidebar-fill);}' +
      '.dfv-nb-cellbody{flex:1;min-width:0;padding:4px 0;}' +
      '.dfv-nb-cellbody .md-code-block,.dfv-nb-cellbody .dfv-code{margin:4px 10px;border-radius:8px;overflow:hidden;}' +
      '.dfv-nb-cellbody .dfv-code-lines{border-radius:8px;overflow:hidden;}' +
      '.dfv-nb-cellbody .dfv-code-gutter{padding:8px 6px 8px 10px;font-size:12px;}' +
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
      '.dfv-td{padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;max-width:360px;}' +
      // 兜底浮层：空会话时原生 tab 条不存在，预览以模态浮层展示
      '.dfv-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));backdrop-filter:var(--dsw-mask-blur,blur(2px));}' +
      '.dfv-overlay-panel{display:flex;flex-direction:column;width:800px;height:min(800px,calc(100vh - 48px));max-width:calc(100vw - 48px);border-radius:24px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3);user-select:text;-webkit-user-select:text;}' +
      '.dfv-overlay-panel.dfv-overlay-max{width:100vw;height:100vh;max-width:none;border-radius:0;border:none;}' +
      '.dfv-overlay-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1;cursor:pointer;padding:0;}' +
      '.dfv-overlay-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}' +
      // 纯阅读模式：预览 tab 激活时隐藏整个输入区（composerSeat：输入框 +
      // GoalBar + 速度徽标所在的 input.dock）与轮次统计行（StatsLine，新版
      // DSH 已把它移进 composerSeat 内部的 conversation.composer.dock）。
      // DSH 0.1.2-alpha.1 起 composerSeat 带 data-composer-seat 稳定属性，
      // 优先用稳定选择器；旧 hash 规则保留以兼容更老的宿主版本。
      '[data-dsh-soup-preview="1"] [data-composer-seat]{display:none !important;}' +
      '[data-dsh-soup-preview="1"] .wSkVaW_composerSeat{display:none !important;}' +
      '[data-dsh-soup-preview="1"] .FJxK0a_root{display:none !important;}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/fileview.css"]') === null) {
      var fileviewTag = document.createElement('style')
      fileviewTag.dataset.plugin = '@lyhue1991/dsh-soup'
      fileviewTag.dataset.pluginCss = '@lyhue1991/dsh-soup/fileview.css'
      fileviewTag.textContent = FILEVIEW_CSS
      document.head.appendChild(fileviewTag)
    }

    /** 需要的客户端服务：slots、layout、timer、sessions、locale（i18n 词典）+ remote.goals（goal 动作动词）。 */
    var inject = ['slots', 'layout', 'timer', 'sessions', 'locale', 'remote', 'remote.goals']

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域零 · i18n / 词典
    //   注册双语词典 NS/DICT；组件内 t()、组件外 T()，语言切换即时生效。
    // ------------------------------------------------------------------
    // i18n：走 DSH 官方插件词典机制（ui-cordis / ui-conversation 同款）——
    // ctx.locale.register(NS, DICT) 注册；槽位配置加 locale: NS 后组件 props
    // 获得 t（语言切换铸造新 t 引用，靠浅比较自动重渲染整棵子树）；组件外
    // 回调（菜单 label、错误横幅）用模块级 T（bind 的 t 每次调用解析当前语言）。
    // ------------------------------------------------------------------
    var NS = 'dsh-soup'
    var DICT = {
      zh: {
        'explorer.title': '📁 资源管理器',
        'explorer.label': '资源管理器',
        'explorer.refresh': '刷新',
        'explorer.refreshTitle': '刷新（保持已展开目录）',
        'explorer.upload': '上传文件',
        'explorer.close': '关闭',
        'explorer.closePanel': '关闭资源管理器',
        'explorer.emptyDir': '（空目录）',
        'explorer.bulkSelected': '已选 {n} 项 · 拖到文件夹可移动',
        'explorer.readFail': '读取失败',
        'explorer.actionFail': '失败',
        'explorer.uploading': '上传中 ',
        'explorer.downloading': '下载中 ',
        'explorer.uploaded': '已上传 {n} 个文件',
        'explorer.filesCount': '{n} 个文件',
        'explorer.filesCountPartial': '{ok}/{total} 个文件',
        'explorer.downloaded': '已下载 {n} 个文件',
        'explorer.uploadFail': '上传失败',
        'explorer.downloadFail': '下载失败',
        'explorer.downloadFailWith': '下载失败: {reason}',
        'explorer.downloadStart': '已开始下载 {name}（大文件，由浏览器接管）',
        'explorer.renamed': '已复制路径',
        'explorer.renameFail': '重命名失败',
        'explorer.createFail': '创建失败',
        'explorer.moveIntoSelf': '不能把文件夹移入自身: {path}',
        'explorer.hostUnreachable': '宿主不可达: {reason}',
        'explorer.hostBadResponse': '宿主响应解析失败',
        'menu.preview': '👁 预览',
        'menu.actions': '更多操作',
        'menu.open': '🖥 用系统打开',
        'menu.rename': '✎ 重命名',
        'menu.trash': '🗑 移到废纸篓',
        'menu.trashMulti': '🗑 移到废纸篓 ({n} 项)',
        'menu.newFile': '📄 新建文件',
        'menu.newFolder': '📁 新建文件夹',
        'menu.copyPath': '⧉ 复制路径',
        'menu.download': '⬇ 下载',
        'menu.deselect': '取消选择',
        'files.tab': '预览',
        'files.emptyHint': '在右侧资源管理器中双击或右键「预览」文件',
        'files.loading': '加载中…',
        'files.readFail': '读取文件失败',
        'files.reload': '重载',
        'files.reloadTitle': '从磁盘重新读取（刷新预览）',
        'files.binary': '二进制文件（{size}），请在资源管理器中用系统打开',
        'files.imageTooLarge': '图片过大（{size}，上限 {limit}）',
        'files.pdfTooLarge': 'PDF 过大（{size}，上限 {limit}），请用系统打开',
        'files.truncated': '文件超过 8 MB，仅预览前 8 MB；完整内容请用系统编辑器打开。',
        'files.jsonFail': 'JSON 解析失败，按纯文本显示',
        'files.nbFail': 'ipynb 解析失败，按纯文本显示',
        'files.nbEmpty': '（空笔记本）',
        'files.nbCells': '共 {n} 个单元格',
        'files.csvTruncated': '共 {total} 行，仅预览前 {n} 行',
        'files.htmlFrame': 'HTML 预览',
        'files.pdfFrame': 'PDF 预览',
        'files.pdfLoading': 'PDF 加载中…',
        'files.pdfFail': 'PDF 预览失败: {reason}',
        'files.pdfUnsupported': '当前浏览器无法内嵌预览 PDF，请右键用系统打开。',
        'files.nbHtmlOut': 'HTML 输出',
        'speed.label': '速度徽标',
        'speed.waiting': '正在等待模型',
        'speed.operateFail': '操作失败',
      },
      en: {
        'explorer.title': '📁 Explorer',
        'explorer.label': 'Explorer',
        'explorer.refresh': 'Refresh',
        'explorer.refreshTitle': 'Refresh (keeps expanded folders)',
        'explorer.upload': 'Upload files',
        'explorer.close': 'Close',
        'explorer.closePanel': 'Close explorer',
        'explorer.emptyDir': '(empty)',
        'explorer.bulkSelected': '{n} selected · drag onto a folder to move',
        'explorer.readFail': 'Failed to read',
        'explorer.actionFail': 'Failed',
        'explorer.uploading': 'Uploading ',
        'explorer.downloading': 'Downloading ',
        'explorer.uploaded': 'Uploaded {n} file(s)',
        'explorer.filesCount': '{n} file(s)',
        'explorer.filesCountPartial': '{ok}/{total} file(s)',
        'explorer.downloaded': 'Downloaded {n} file(s)',
        'explorer.uploadFail': 'Upload failed',
        'explorer.downloadFail': 'Download failed',
        'explorer.downloadFailWith': 'Download failed: {reason}',
        'explorer.downloadStart': 'Downloading {name} (large file, handled by the browser)',
        'explorer.renamed': 'Path copied',
        'explorer.renameFail': 'Rename failed',
        'explorer.createFail': 'Create failed',
        'explorer.moveIntoSelf': 'Cannot move a folder into itself: {path}',
        'explorer.hostUnreachable': 'Host unreachable: {reason}',
        'explorer.hostBadResponse': 'Failed to parse host response',
        'menu.preview': '👁 Preview',
        'menu.actions': 'More actions',
        'menu.open': '🖥 Open with system',
        'menu.rename': '✎ Rename',
        'menu.trash': '🗑 Move to trash',
        'menu.trashMulti': '🗑 Move to trash ({n})',
        'menu.newFile': '📄 New file',
        'menu.newFolder': '📁 New folder',
        'menu.copyPath': '⧉ Copy path',
        'menu.download': '⬇ Download',
        'menu.deselect': 'Clear selection',
        'files.tab': 'Preview',
        'files.emptyHint': 'Double-click a file (or right-click → Preview) in the explorer',
        'files.loading': 'Loading…',
        'files.readFail': 'Failed to read file',
        'files.reload': 'Reload',
        'files.reloadTitle': 'Re-read from disk (refresh preview)',
        'files.binary': 'Binary file ({size}) — open with the system explorer',
        'files.imageTooLarge': 'Image too large ({size}, limit {limit})',
        'files.pdfTooLarge': 'PDF too large ({size}, limit {limit}) — open with the system viewer',
        'files.truncated': 'File exceeds 8 MB — showing the first 8 MB; open in a system editor for the full content.',
        'files.jsonFail': 'JSON parse failed — shown as plain text',
        'files.nbFail': 'ipynb parse failed — shown as plain text',
        'files.nbEmpty': '(empty notebook)',
        'files.nbCells': '{n} cells',
        'files.csvTruncated': '{total} rows — showing the first {n}',
        'files.htmlFrame': 'HTML preview',
        'files.pdfFrame': 'PDF preview',
        'files.pdfLoading': 'Loading PDF…',
        'files.pdfFail': 'PDF preview failed: {reason}',
        'files.pdfUnsupported': 'This browser cannot embed PDF previews — right-click and open with the system viewer.',
        'files.nbHtmlOut': 'HTML output',
        'speed.label': 'Speed badge',
        'speed.waiting': 'Waiting for the model',
        'speed.operateFail': 'Action failed',
      },
    }
    /** 模块级翻译函数（apply 里由 ctx.locale.bind 填充）。 */
    var T = function (key, params) { return key }

    // ------------------------------------------------------------------
    // 状态存储（模块级，供 Panel 与 HeaderAction 共享）
    // ------------------------------------------------------------------
    var state = {
      open: false, cwd: '', tree: [], menu: null, error: '', notice: '',
      selected: new Set(), lastIndex: null,
      renaming: null, newItem: null,
      dropTarget: null, dragPaths: null,
      files: { list: [], active: null, overlay: false, overlayMax: false, overlayReturn: null },
      uploads: [],
    }
    var listeners = new Set()
    // trackSession() is called by both the hero toggle and the details panel
    // while a blank conversation is mounted. Keep late async responses from an
    // older caller from overwriting the current session's shared store.
    var sessionTrackGeneration = 0

    // 目录展开状态按 cwd 隔离。刷新/删除/改名/移动后先重拉根目录，
    // 再按这些路径递归重拉仍存在的已展开目录；切换项目时才清空。
    var expandedDirs = new Set()
    var expandedDirsCwd = null

    function forgetExpandedPaths(paths) {
      var dropped = paths.map(function (p) { return [p, p + '/'] })
      expandedDirs = new Set(Array.from(expandedDirs).filter(function (p) {
        return !dropped.some(function (pair) { return p === pair[0] || p.startsWith(pair[1]) })
      }))
    }

    function rekeyExpandedPaths(from, to) {
      var moved = Array.from(expandedDirs).filter(function (p) {
        return p === from || p.startsWith(from + '/')
      }).sort(function (a, b) { return a.length - b.length })
      if (!moved.length) return
      var next = new Set(Array.from(expandedDirs).filter(function (p) {
        return p !== from && !p.startsWith(from + '/')
      }))
      moved.forEach(function (p) { next.add(to + p.slice(from.length)) })
      expandedDirs = next
    }

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

    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（共享数据层）
    //   共享 store、/api/dsh-soup RPC、树数据加载/自动刷新、selection、拖拽/上传/下载、类型图标 —— 预览亦复用其中 store/rpc。
    // ------------------------------------------------------------------
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
        return res.json().catch(function () { return { ok: false, error: T('explorer.hostBadResponse') } })
      }).catch(function (err) {
        return { ok: false, error: T('explorer.hostUnreachable', { reason: String((err && err.message) || err) }) }
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
        setState({ error: (res && res.error) || T('explorer.readFail') })
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
      var generation = ++sessionTrackGeneration
      activeSessionId = sessionId || null
      var cwd = await defaultCwd(sessionId, cwdHint)
      if (generation !== sessionTrackGeneration) return
      // 换项目时展开状态没有跨项目意义；回到同一项目则保留。
      if (expandedDirsCwd !== cwd) {
        expandedDirs.clear()
        expandedDirsCwd = cwd
      }
      // 会话切换：预览列表按新 cwd 裁剪（范围外自动关闭），并清掉上一路径的旧错误横幅
      var files = pruneFilesToScope(state.files, cwd)
      lastMtimes = {} // 换了目录，旧 mtime 基线全部作废（首轮 tick 重建基线）
      setState({ cwd: cwd, selected: new Set(), renaming: null, newItem: null, menu: null, error: '', notice: '', files: files })
      var items = await loadDir(cwd)
      if (generation !== sessionTrackGeneration) return
      if (items) setState({ error: '', tree: items })
    }

    async function refresh() {
      if (!state.cwd) return
      var items = await loadDir(state.cwd)
      if (!items) return
      await restoreExpandedChildren(items)
      setState({ error: '', tree: items })
    }

    /** 根目录刷新后，按记住的路径递归恢复已展开目录。 */
    async function restoreExpandedChildren(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (node.type !== 'directory' || !expandedDirs.has(node.path)) continue
        var items = await loadDir(node.path)
        if (!items) {
          expandedDirs.delete(node.path)
          continue
        }
        node.open = true
        node.children = items
        items.forEach(function (child) { child.parent = node })
        await restoreExpandedChildren(items)
      }
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
      await refresh()
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
        node.open = !!items
        if (items) expandedDirs.add(node.path)
        // 拖拽可能把一个已展开目录移进此前收起的父目录。父目录首次展开时，
        // 也要立即恢复其中被记住的子目录展开状态。
        if (items) await restoreExpandedChildren(items)
        setState({ tree: state.tree })
      } else {
        node.open = !node.open
        if (node.open) expandedDirs.add(node.path)
        else expandedDirs.delete(node.path)
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
      // Seti 字体图标：覆盖 SVG 未收录的代码/配置/二进制/媒体类型
      var setiKey = SETI_EXT[ext]
      if (setiKey) return '<span class="seti-ico seti-' + setiKey + '"></span>'
      // 兜底：已知代码语言 → 文本编辑器图标；其余（LICENSE、无扩展名等）→ 空白文件
      var codeish = Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, ext)
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

    // ------------------------------------------------------------------
    // Seti 图标字体：VS Code 默认方案（MIT，源自 jesseweed/seti-ui）。
    // WOFF 字体 + CSS ::before 渲染 Unicode 字符 + 每图标独立颜色。
    // 补全 NB_SVG SVG 图标未覆盖的代码 / 配置 / 二进制 / 媒体类型。
    // ------------------------------------------------------------------

    /** Seti WOFF 字体 base64（37 KB 原始 → ~50 KB base64）。 */
    var SETI_FONT_B64 = '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'

    /** 图标定义 key → { c: fontCharacter, col: fontColor }。 */
    var SETI_ICONS = {
      ts: { c: '\\E099', col: '#519aba' },
      react: { c: '\\E07D', col: '#519aba' },
      js: { c: '\\E051', col: '#cbcb41' },
      sql: { c: '\\E022', col: '#f55385' },
      rs: { c: '\\E082', col: '#6d8086' },
      go: { c: '\\E03A', col: '#519aba' },
      sh: { c: '\\E089', col: '#8dc149' },
      css: { c: '\\E01D', col: '#519aba' },
      less: { c: '\\E059', col: '#519aba' },
      sass: { c: '\\E084', col: '#f55385' },
      java: { c: '\\E050', col: '#cc3e44' },
      cs: { c: '\\E00B', col: '#519aba' },
      cpp: { c: '\\E01A', col: '#519aba' },
      c: { c: '\\E00C', col: '#519aba' },
      objc: { c: '\\E00C', col: '#cbcb41' },
      rb: { c: '\\E081', col: '#cc3e44' },
      php: { c: '\\E070', col: '#a074c4' },
      swift: { c: '\\E092', col: '#e37933' },
      kotlin: { c: '\\E058', col: '#e37933' },
      vue: { c: '\\E09D', col: '#8dc149' },
      xml: { c: '\\E0A5', col: '#e37933' },
      lua: { c: '\\E05E', col: '#519aba' },
      perl: { c: '\\E06E', col: '#519aba' },
      ps1: { c: '\\E074', col: '#519aba' },
      dart: { c: '\\E021', col: '#519aba' },
      scala: { c: '\\E086', col: '#cc3e44' },
      sol: { c: '\\E02D', col: '#519aba' },
      hs: { c: '\\E044', col: '#a074c4' },
      ml: { c: '\\E06A', col: '#e37933' },
      ex: { c: '\\E028', col: '#a074c4' },
      clj: { c: '\\E013', col: '#8dc149' },
      coffee: { c: '\\E016', col: '#cbcb41' },
      zig: { c: '\\E0A8', col: '#e37933' },
      nim: { c: '\\E065', col: '#cbcb41' },
      cr: { c: '\\E01B', col: '#d4d7d6' },
      d: { c: '\\E020', col: '#cc3e44' },
      asm: { c: '\\E004', col: '#cc3e44' },
      gradle: { c: '\\E03C', col: '#519aba' },
      tf: { c: '\\E093', col: '#a074c4' },
      graphql: { c: '\\E03E', col: '#f55385' },
      twig: { c: '\\E098', col: '#8dc149' },
      erb: { c: '\\E049', col: '#cc3e44' },
      haml: { c: '\\E042', col: '#cc3e44' },
      mustache: { c: '\\E063', col: '#e37933' },
      liquid: { c: '\\E05B', col: '#8dc149' },
      ejs: { c: '\\E027', col: '#cbcb41' },
      pug: { c: '\\E078', col: '#cc3e44' },
      styl: { c: '\\E08E', col: '#8dc149' },
      njk: { c: '\\E069', col: '#8dc149' },
      slim: { c: '\\E08A', col: '#e37933' },
      toml: { c: '\\E019', col: '#6d8086' },
      makefile: { c: '\\E05F', col: '#e37933' },
      bat: { c: '\\E0A2', col: '#519aba' },
      zip: { c: '\\E0A9', col: '#6d8086' },
      font: { c: '\\E033', col: '#cc3e44' },
      audio: { c: '\\E005', col: '#a074c4' },
      video: { c: '\\E09B', col: '#f55385' },
      illustrator: { c: '\\E04B', col: '#cbcb41' },
      photoshop: { c: '\\E06F', col: '#519aba' },
      git: { c: '\\E034', col: '#41535b' },
    }

    /** 扩展名 → Seti 图标 key（多对一：语言/框架共享同一字形）。 */
    var SETI_EXT = {
      ts: 'ts', mts: 'ts', cts: 'ts',
      tsx: 'react',
      js: 'js', mjs: 'js', cjs: 'js', es6: 'js',
      jsx: 'react',
      sql: 'sql', db: 'sql', sqlite: 'sql',
      rs: 'rs', go: 'go', d: 'd', s: 'asm', asm: 'asm', zig: 'zig',
      sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh',
      bat: 'bat', cmd: 'bat',
      css: 'css', less: 'less', sass: 'sass', scss: 'sass', styl: 'styl',
      java: 'java', cs: 'cs', kt: 'kotlin', kts: 'kotlin', scala: 'scala', gradle: 'gradle',
      c: 'c', h: 'c', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', hpp: 'cpp',
      m: 'objc',
      rb: 'rb', php: 'php', pl: 'perl', pm: 'perl',
      swift: 'swift', lua: 'lua',
      vue: 'vue',
      xml: 'xml', xsl: 'xml', xsd: 'xml', xslt: 'xml',
      twig: 'twig', erb: 'erb', haml: 'haml',
      mustache: 'mustache', hbs: 'mustache',
      liquid: 'liquid', ejs: 'ejs',
      pug: 'pug', jade: 'pug',
      njk: 'njk', nunjucks: 'njk', slim: 'slim',
      toml: 'toml', properties: 'toml', cfg: 'toml', conf: 'toml', env: 'toml', ini: 'toml',
      mk: 'makefile', make: 'makefile', makefile: 'makefile',
      ps1: 'ps1', psm1: 'ps1',
      graphql: 'graphql', gql: 'graphql',
      sol: 'sol',
      hs: 'hs', lhs: 'hs', ml: 'ml', mli: 'ml',
      ex: 'ex', exs: 'ex', clj: 'clj', cljs: 'clj', cljc: 'clj', edn: 'clj',
      coffee: 'coffee',
      nim: 'nim', cr: 'cr',
      dart: 'dart',
      tf: 'tf', tfvars: 'tf',
      zip: 'zip', gz: 'zip', tar: 'zip', bz2: 'zip', xz: 'zip', '7z': 'zip', rar: 'zip',
      woff: 'font', woff2: 'font', ttf: 'font', eot: 'font', otf: 'font',
      mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
      mp4: 'video', avi: 'video', mov: 'video', mkv: 'video', webm: 'video',
      ai: 'illustrator', psd: 'photoshop',
      gitignore: 'git', gitattributes: 'git', gitmodules: 'git',
    }

    /** 生成 Seti 字体 CSS（@font-face + 每图标 ::before 规则）。 */
    function setiIconCss() {
      var rules = [
        '@font-face{font-family:"seti";src:url(data:font/woff;base64,' + SETI_FONT_B64 + ') format("woff");font-weight:normal;font-style:normal;font-display:block;}',
        '.seti-ico{font-family:"seti";font-size:16px;line-height:16px;display:inline-block;width:16px;text-align:center;vertical-align:middle;flex:none;}',
      ]
      for (var key in SETI_ICONS) {
        var ico = SETI_ICONS[key]
        rules.push('.seti-ico.seti-' + key + '::before{content:"' + ico.c + '";color:' + ico.col + ';}')
      }
      return rules.join('\n')
    }

    // Seti 图标字体 CSS：@font-face + 每图标 ::before 规则
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/seti-icons.css"]') === null) {
      var setiTag = document.createElement('style')
      setiTag.dataset.plugin = '@lyhue1991/dsh-soup'
      setiTag.dataset.pluginCss = '@lyhue1991/dsh-soup/seti-icons.css'
      setiTag.textContent = setiIconCss()
      document.head.appendChild(setiTag)
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

    function onRowMore(e, node) {
      e.preventDefault()
      e.stopPropagation()
      var sel = new Set(state.selected)
      sel.clear()
      sel.add(node.path)
      var rect = e.currentTarget.getBoundingClientRect()
      setState({ selected: sel, lastIndex: null, menu: { x: rect.right - 4, y: rect.bottom + 4, node: node } })
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
      var trashed = []
      for (var i = 0; i < paths.length; i++) {
        var res = await rpc('trash', { path: paths[i] })
        if (res && res.ok) trashed.push(paths[i])
        else errors.push(baseName(paths[i]) + ': ' + ((res && res.error) || T('explorer.actionFail')) + ((res && res.hint) ? '（' + res.hint + '）' : ''))
      }
      if (errors.length) setState({ error: errors.join('；') })
      forgetExpandedPaths(trashed)
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
      var node = findNode(state.tree, path)
      var isDir = node && node.type === 'directory'
      var sel = new Set(state.selected)
      if (sel.has(path)) { sel.delete(path); sel.add(dest) }
      setState({ renaming: null, selected: sel })
      ;(async function () {
        var res = await rpc('move', { from: path, to: dest })
        if (res && res.ok) {
          if (isDir) rekeyExpandedPaths(path, dest)
        } else {
          setState({ error: (res && res.error) || T('explorer.renameFail') })
        }
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
        if (!res || !res.ok) setState({ error: (res && res.error) || T('explorer.createFail') })
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
          navigator.clipboard.writeText(p).then(function () { showNotice(T('explorer.renamed')) }).catch(function () {})
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
      var moved = []
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i]
        if (p === '/' || !p) continue
        var name = baseName(p)
        var dest = pathJoin(targetDir, name)
        if (dest === p) continue
        if (targetDir === p || targetDir.startsWith(p + '/')) { errors.push(T('explorer.moveIntoSelf', { path: name })); continue }
        var node = findNode(state.tree, p)
        var res = await rpc('move', { from: p, to: dest })
        if (res && res.ok) {
          moved.push({ from: p, to: dest, isDir: node && node.type === 'directory' })
        } else {
          errors.push(name + ': ' + ((res && res.error) || T('explorer.actionFail')))
        }
      }
      setState({ dragPaths: null })
      moved.forEach(function (item) {
        if (item.isDir) rekeyExpandedPaths(item.from, item.to)
      })
      if (errors.length) setState({ error: errors.join('；') })
      await refresh()
    }

    function fileToBase64(file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader()
        r.onload = function () { var s = String(r.result || ''); var i = s.indexOf(','); resolve(i >= 0 ? s.slice(i + 1) : s) }
        r.onerror = function () { reject(new Error(T('files.readFail'))) }
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
      var verb = down ? T('explorer.downloaded') : T('explorer.uploaded')
      setUploadEntry({
        name: '✓ ' + verb + ' ' + (okCount === count ? T('explorer.filesCount', { n: count }) : T('explorer.filesCountPartial', { ok: okCount, total: count }) + (failedName ? '（' + failedName + '）' : '')),
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
        if (!res || !res.ok) throw new Error((res && res.error) || T('explorer.uploadFail'))
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
        setState({ error: (res && res.error) || T('explorer.downloadFail') })
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
        showNotice(T('explorer.downloadStart', { name: name }))
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
        setState({ error: T('explorer.downloadFailWith', { reason: String((err && err.message) || err) }), uploads: [] })
      }
    }

    function onUploadPicker(e) {
      var files = Array.from((e.target && e.target.files) || [])
      uploadFiles(state.cwd, files)
      e.target.value = ''
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（列表 UI）
    //   NameInput / Row / buildMenuItems / Menu：行渲染、多选、右键菜单、重命名/新建。
    // ------------------------------------------------------------------
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
        isDir || depth > 0
          ? create('span', {
              className: 'expl-caret' + (isDir ? ' expl-caret-big' + (depth === 0 ? ' expl-caret-root' : '') + (node.open ? ' open' : '') : ' expl-caret-sm'),
              onClick: function (e) { if (isDir) { e.stopPropagation(); toggleNode(node) } },
            }, '')
          : null,
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
        create('button', {
          className: 'expl-row-more',
          type: 'button',
          title: T('menu.actions'),
          'aria-label': T('menu.actions'),
          onClick: function (e) { onRowMore(e, node) },
        }, create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_MORE } })),
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
          children.push(create('div', { key: '__loading__', className: 'expl-muted', style: { paddingLeft: 8 + (depth + 1) * 16 } }, T('files.loading')))
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
            items.push({ key: 'open-tab', label: T('menu.preview'), onClick: function () { openFileInTab(node.path) } })
            items.push({ key: 'open', label: T('menu.open'), onClick: openSelection, separatorAfter: true })
          } else {
            items.push({ key: 'open', label: T('menu.open'), onClick: openSelection, separatorAfter: true })
          }
          items.push({ key: 'rename', label: T('menu.rename'), onClick: function () { startRename(node) } })
          items.push({ key: 'trash', label: T('menu.trash'), danger: true, onClick: trashSelection, separatorAfter: true })
        } else {
          items.push({ key: 'trash', label: T('menu.trashMulti', { n: state.selected.size }), danger: true, onClick: trashSelection, separatorAfter: true })
        }
        if (node.type === 'directory') {
          items.push({ key: 'newfile', label: T('menu.newFile'), onClick: function () { startNew(node.path, false) } })
          items.push({ key: 'newfolder', label: T('menu.newFolder'), onClick: function () { startNew(node.path, true) }, separatorAfter: true })
        }
        items.push({ key: 'copy', label: T('menu.copyPath'), onClick: function () { copyPath(node) } })
        if (node.type !== 'directory') {
          items.push({ key: 'download', label: T('menu.download'), onClick: function () { downloadFile(node.path) } })
        }
      } else {
        items.push({ key: 'newfile', label: T('menu.newFile'), onClick: function () { startNew(state.cwd, false) } })
        items.push({ key: 'newfolder', label: T('menu.newFolder'), onClick: function () { startNew(state.cwd, true) } })
        items.push({ key: 'refresh', label: [create('span', { className: 'expl-menu-ico', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }), T('explorer.refresh')], onClick: refresh, separatorAfter: true })
        if (state.selected.size > 0) items.push({ key: 'none', label: T('menu.deselect'), onClick: function () { setState({ selected: new Set(), lastIndex: null }) } })
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
    // ------------------------------------------------------------------
    // ▓▓ 区域一 · 资源管理器 · 🧅 葱（面板与入口）
    //   Panel（右列 details 面板）/ HeaderAction（Session log 侧 📁）/ HeroAction（空白会话 📁）。
    // ------------------------------------------------------------------
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
        bodyChildren.push(create('div', { key: '__empty__', className: 'expl-muted' }, T('explorer.emptyDir')))
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
          create('span', { className: 'expl-title' }, T('explorer.title')),
          create('div', { className: 'expl-head-btns' },
            create('button', {
              className: 'expl-btn',
              onClick: function () { refreshAll() },
              title: T('explorer.refreshTitle'),
              'aria-label': T('explorer.refresh'),
            }, create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } })),
            create('button', {
              className: 'expl-btn',
              onClick: function () { if (uploadInputEl) uploadInputEl.click() },
              title: T('explorer.upload'),
              'aria-label': T('explorer.upload'),
            }, '⬆'),
            create('button', {
              className: 'expl-btn',
              onClick: function (event) {
                try { layout.closeDetails() } catch (e) {}
                setHeroDetailsWidth(event.currentTarget, 0)
              },
              title: T('explorer.close'),
              'aria-label': T('explorer.closePanel'),
            }, '✕'),
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
                  : (u.down ? T('explorer.downloading') : T('explorer.uploading')) + (u.totalFiles > 1 ? '(' + u.idx + '/' + u.totalFiles + ') ' : '') + u.name,
              ),
              !u.done && u.total ? create('span', { className: 'expl-upload-pct' }, pct + '%') : null,
            )
          }),
        ) : null,
        create('input', { type: 'file', multiple: true, style: { display: 'none' }, ref: function (el) { uploadInputEl = el }, onChange: onUploadPicker }),
        s.error ? create('div', { className: 'expl-error' }, s.error) : null,
        s.notice ? create('div', { className: 'expl-notice' }, s.notice) : null,
        s.selected.size > 1
          ? create('div', { className: 'expl-bulk' }, T('explorer.bulkSelected', { n: s.selected.size }))
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
        title: T('explorer.label'),
        'aria-label': T('explorer.label'),
      }, '📁')
    }

    function HeroAction(props) {
      var s = useStore()
      var session = props && props.session
      var useSessions = props && props.useSessions
      // DSH 0.1.2-alpha.1 移除了 SessionSnapshot.composerPhase（blank 阶段改由
      // conversationPhase() 从 blank/promptAttempted 派生）；旧版仍带该字段时沿用旧判断。
      var sessionId = (props && props.sessionId) || (session && session.sessionId)
      var blankPhase = session && (session.composerPhase !== undefined
        ? session.composerPhase === 'blank'
        : !session.promptAttempted)
      var blank = !!(session && session.blank && blankPhase)
      var liveCwd = useSessions ? useSessions(function (list) {
        return (sessionId && list.byId[sessionId]) ? list.byId[sessionId].cwd : undefined
      }) : undefined
      React.useEffect(function () {
        if (blank) trackSession(sessionId, liveCwd)
      }, [blank, sessionId])
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
          title: T('explorer.label'),
          'aria-label': T('explorer.label'),
        }, '📁'))
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域二 · 会话内预览 · 🫚 姜（files tab 状态）
    //   files tab 状态机：打开/重载/关闭、FIFO(≤5)、会话切换按 cwd 裁剪。
    // ------------------------------------------------------------------
    // 文件标签页：右键/双击「预览」把文件以只读预览展示进会话区的「预览」
    // tab（原生 conversation.view 槽位，与 对话/轨迹 同级）。
    // markdown/html/json/csv 有专属渲染器；图片预览；其余按纯文本。
    // 状态存模块级 store，切走 tab 再切回来内容不丢。
    // ------------------------------------------------------------------
    var FILES_TAB_LABEL = function () { return T('files.tab') }

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
        }
        // FIFO：最多同时 5 个预览，新开的挤掉最早打开的
        var list = state.files.list.slice()
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
      var res = await rpc('read', { path: path, sessionId: activeSessionId })
      if (!res.ok && /超出允许范围/.test(res.error || '')) {
        await new Promise(function (r) { setTimeout(r, 600) })
        res = await rpc('read', { path: path, sessionId: activeSessionId })
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

    // ------------------------------------------------------------------
    // ▓▓ 区域二 · 会话内预览 · 🫚 姜（渲染器）
    //   按扩展名分派 md/html/pdf/notebook/json/csv + 图片/纯文本兜底 + FileContent + FilesView 子标签条。
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

    var MarkdownRenderBoundary = React.Component
      ? class MarkdownRenderBoundary extends React.Component {
          constructor(props) {
            super(props)
            this.state = { failed: false }
          }
          static getDerivedStateFromError() { return { failed: true } }
          componentDidCatch(err) {
            try { window.__DSH_MARKDOWN_PREVIEW_ERROR = String((err && err.message) || err) } catch (_) {}
          }
          componentDidUpdate(prevProps) {
            if (this.state.failed && prevProps.text !== this.props.text) this.setState({ failed: false })
          }
          render() {
            if (this.state.failed) return create(SafeMarkdownFallback, { text: this.props.text })
            return this.props.children
          }
        }
      : function MarkdownRenderBoundaryFallback(props) { return props.children }

    // Last-resort renderer for hosts whose MarkdownText/CodeBlock bundle throws.
    // Keep the document readable and, importantly, never expose the full source
    // as one giant preformatted block just because one fenced block failed.
    function SafeMarkdownInline(text) {
      var parts = String(text || '').split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*))/g)
      return parts.map(function (part, i) {
        if (/^`[^`\n]+`$/.test(part)) {
          return create('code', { key: i, className: 'markdown-inline-code' }, part.slice(1, -1))
        }
        if (/^\*\*[^*\n]+\*\*$/.test(part)) {
          return create('strong', { key: i }, part.slice(2, -2))
        }
        if (/^\*[^*\n]+\*$/.test(part)) {
          return create('em', { key: i }, part.slice(1, -1))
        }
        return part
      })
    }
    function SafeMarkdownFallback(props) {
      var lines = String(props.text || '').split(/\r?\n/)
      var blocks = []
      var paragraph = []
      var code = null
      function flushParagraph() {
        if (!paragraph.length) return
        blocks.push(create('p', { key: blocks.length }, SafeMarkdownInline(paragraph.join(' '))))
        paragraph = []
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i]
        var fence = /^\s*```\s*([\w-]*)\s*$/.exec(line)
        if (fence) {
          if (code) {
            blocks.push(create('pre', { key: blocks.length, className: 'dfv-code' }, create('code', null, code.lines.join('\n'))))
            code = null
          } else {
            flushParagraph()
            code = { lang: fence[1], lines: [] }
          }
          continue
        }
        if (code) { code.lines.push(line); continue }
        if (/^\s*$/.test(line)) { flushParagraph(); continue }
        // GFM table: header row followed by the required delimiter row.
        if (line.indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
          flushParagraph()
          var splitRow = function (value) {
            var s = String(value).trim().replace(/^\|/, '').replace(/\|$/, '')
            return s.split('|').map(function (cell) { return cell.trim() })
          }
          var headers = splitRow(line)
          i += 1
          var tableRows = []
          while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && !/^\s*$/.test(lines[i + 1])) {
            i += 1
            tableRows.push(splitRow(lines[i]))
          }
          var head = create('tr', null, headers.map(function (cell, hi) {
            return create('th', { key: hi, className: 'dfv-th' }, SafeMarkdownInline(cell))
          }))
          var bodyRows = tableRows.map(function (row, ri) {
            return create('tr', { key: ri }, headers.map(function (_, ci) {
              return create('td', { key: ci, className: 'dfv-td' }, SafeMarkdownInline(row[ci] || ''))
            }))
          })
          var table = create('table', { className: 'dfv-table' },
            create('thead', null, head),
            create('tbody', null, bodyRows))
          blocks.push(create('div', { key: blocks.length, className: 'dfv-table-wrap' }, table))
          continue
        }
        var heading = /^(#{1,6})\s+(.+)$/.exec(line)
        if (heading) {
          flushParagraph()
          blocks.push(create('h' + heading[1].length, { key: blocks.length }, SafeMarkdownInline(heading[2])))
        } else {
          paragraph.push(line)
        }
      }
      if (code) blocks.push(create('pre', { key: blocks.length, className: 'dfv-code' }, create('code', null, code.lines.join('\n'))))
      flushParagraph()
      return create('div', { className: 'dfv-safe-md' }, blocks)
    }

    function MarkdownPreview(props) {
      var text = props.text
      if (MarkdownText) {
        // Keep the original MarkdownText source contract visible for host integrations.
        // create(MarkdownText, { text: md })
        var md = props.baseDir ? absolutizeMarkdownImages(text, props.baseDir) : text
        var lines = String(md || '').split(/\r?\n/)
        var chunks = []
        var normal = []
        var fenced = null
        function pushNormal() {
          if (!normal.length) return
          var value = normal.join('\n')
          if (value.trim() !== '') chunks.push(create(MarkdownRenderBoundary, { key: 'md-' + chunks.length, text: value }, create(MarkdownText, { text: value })))
          normal = []
        }
        function pushTable(headerLine) {
          var splitRow = function (value) {
            var s = String(value).trim().replace(/^\|/, '').replace(/\|$/, '')
            return s.split('|').map(function (cell) { return cell.trim() })
          }
          var headers = splitRow(headerLine)
          var renderCell = function (cell, key) {
            return create(MarkdownRenderBoundary, { key: key, text: cell }, create(MarkdownText, { text: cell }))
          }
          var head = create('tr', null, headers.map(function (cell, hi) {
            return create('th', { key: hi, className: 'dfv-th' }, renderCell(cell, 'th-' + hi))
          }))
          var rows = []
          while (i + 1 < lines.length && lines[i + 1].indexOf('|') !== -1 && !/^\s*$/.test(lines[i + 1])) {
            var nextRow = splitRow(lines[i + 1])
            if (nextRow.length < headers.length) break
            i += 1
            rows.push(nextRow)
          }
          var body = rows.map(function (row, ri) {
            return create('tr', { key: ri }, headers.map(function (_, ci) {
              return create('td', { key: ci, className: 'dfv-td' }, renderCell(row[ci] || '', 'td-' + ri + '-' + ci))
            }))
          })
          chunks.push(create('div', { key: 'table-' + chunks.length, className: 'dfv-table-wrap' },
            create('table', { className: 'dfv-table' },
              create('thead', null, head), create('tbody', null, body))))
        }
        for (var i = 0; i < lines.length; i++) {
          var fence = /^\s*```\s*([\w-]*)\s*$/.exec(lines[i])
          if (fence) {
            if (fenced) {
              chunks.push(create('pre', { key: 'code-' + chunks.length, className: 'dfv-code md-code-block', 'data-language': fenced.lang }, create('code', null, fenced.lines.join('\n'))))
              fenced = null
            } else {
              pushNormal()
              fenced = { lang: fence[1], lines: [] }
            }
          } else if (fenced) {
            fenced.lines.push(lines[i])
          } else if (lines[i].indexOf('|') !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
            pushNormal()
            i += 1
            pushTable(lines[i - 1])
          } else {
            normal.push(lines[i])
          }
        }
        if (fenced) chunks.push(create('pre', { key: 'code-' + chunks.length, className: 'dfv-code md-code-block', 'data-language': fenced.lang }, create('code', null, fenced.lines.join('\n'))))
        pushNormal()
        return create('div', { className: 'dfv-md-wrap' }, create('div', { className: 'dfv-md' }, chunks))
      }
      // 回退：宿主缺 ui-primitives 时按纯文本展示
      return create('pre', { className: 'dfv-code' }, text)
    }

    function HtmlPreview(props) {
      // 可交互预览：给 allow-scripts/popups/forms/modals（对齐 JupyterLab
      // trusted 档），但坚持不给 allow-same-origin——脚本跑在 opaque origin，
      // 触不到 GUI 的 DOM/存储/Cookie；srcdoc 注入 + no-referrer 收敛外链。
      // 微信文章兼容：正文 #js_content 初始 visibility:hidden 靠 JS 展开，
      // 图片用 data-src 懒加载靠 JS 换 src——沙箱里两者都跑不起来。
      // 注入一段 CSS 强制显示正文，并预先把 data-src 落到 src。
      var text = props.text || ''
      if (text.indexOf('js_content') !== -1 || text.indexOf('data-src=') !== -1) {
        var inject = '<style>#js_content{visibility:visible!important;opacity:1!important;}</style>'
        if (/<\/head>/i.test(text)) {
          text = text.replace(/<\/head>/i, inject + '</head>')
        } else {
          text = inject + text
        }
        text = text.replace(/(<img\b[^>]*?)\sdata-src=/gi, '$1 src=')
      }
      return create('iframe', {
        className: 'dfv-frame',
        sandbox: 'allow-scripts allow-popups allow-forms allow-modals',
        referrerPolicy: 'no-referrer',
        title: props.title || T('files.htmlFrame'),
        srcDoc: text,
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
      if (state.error) return create('div', { className: 'dfv-error' }, T('files.pdfFail', { reason: state.error }))
      if (!state.url) return create('div', { className: 'dfv-empty' }, T('files.pdfLoading'))
      return create('object', {
        className: 'dfv-frame dfv-pdf',
        type: 'application/pdf',
        data: state.url,
        'aria-label': T('files.pdfFrame'),
      }, T('files.pdfUnsupported'))
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
          return create('iframe', { className: 'dfv-nb-html', sandbox: '', title: T('files.nbHtmlOut'), srcDoc: nbSource(out.data[mime]) })
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
          create('div', { className: 'dfv-cap' }, T('files.nbFail')),
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
            create(CodeWithLines, { text: codeSrc },
              CodeBlock
                ? create(CodeBlock, { code: codeSrc, lang: codeLang })
                : create('pre', { className: 'dfv-code' }, codeSrc)),
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
          'Jupyter Notebook' + (kernelName ? ' · ' + kernelName : '') + ' · ' + T('files.nbCells', { n: cells.length })),
        cellEls.length ? cellEls : create('div', { className: 'dfv-muted' }, T('files.nbEmpty')))
    }

    function JsonPreview(props) {
      var failed = false
      try { JSON.parse(props.text) } catch (err) { failed = true }
      if (failed) {
        return create(React.Fragment, null,
          create('div', { className: 'dfv-cap' }, T('files.jsonFail')),
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
      if (totalRows > CSV_MAX_ROWS + 1) caps.push(T('files.csvTruncated', { total: totalRows, n: CSV_MAX_ROWS }))
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

    /** 代码内容 + 左侧行号列（源码文件 / notebook code cell 用）。 */
    function CodeWithLines(props) {
      var text = props.text || ''
      var lineCount = text.split('\n').length
      var nums = []
      for (var i = 1; i <= lineCount; i++) nums.push(create('div', { key: i }, String(i)))
      return create('div', { className: 'dfv-code-lines' },
        create('div', { className: 'dfv-code-gutter', 'aria-hidden': true }, nums),
        create('div', { className: 'dfv-code-main' }, props.children),
      )
    }

    function FileContent(props) {
      var entry = props.entry
      if (entry.loading) {
        return create('div', { className: 'dfv-empty' }, T('files.loading'))
      }
      if (entry.error) {
        return create('div', { className: 'dfv-error' }, entry.error)
      }
      if (entry.kind === 'binary') {
        return create('div', { className: 'dfv-muted' },
          T('files.binary', { size: formatBytes(entry.size) }))
      }
      if (entry.kind === 'image-too-large') {
        return create('div', { className: 'dfv-muted' },
          T('files.imageTooLarge', { size: formatBytes(entry.size), limit: formatBytes(entry.limit) }))
      }
      if (entry.kind === 'image') {
        return create('div', { className: 'dfv-image-wrap' },
          create('img', { className: 'dfv-image', src: entry.dataUrl, alt: entry.name }))
      }
      if (entry.kind === 'pdf-too-large') {
        return create('div', { className: 'dfv-muted' },
          T('files.pdfTooLarge', { size: formatBytes(entry.size), limit: formatBytes(entry.limit) }))
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
        // 都包在 CodeWithLines 里加左侧行号
        var lang = Object.prototype.hasOwnProperty.call(CODE_LANG_BY_EXT, extOfName(entry.path))
          ? CODE_LANG_BY_EXT[extOfName(entry.path)]
          : undefined
        var codeEl = (CodeBlock && lang && entry.content.length <= CODE_HIGHLIGHT_MAX_CHARS)
          ? create(CodeBlock, { code: entry.content, lang: lang })
          : create('pre', { className: 'dfv-code' }, entry.content)
        view = create(CodeWithLines, { text: entry.content }, codeEl)
      }
      return create(React.Fragment, null,
        entry.truncated ? create('div', { className: 'dfv-cap' },
          T('files.truncated')) : null,
        view,
      )
    }

    /**
     * 纯阅读模式标记：在会话根（含 composerSeat 的最近祖先，即 DSH
     * ConversationRoot 的 root 节点）上打 data-dsh-soup-preview，由上面
     * 注入的 CSS 隐藏输入区与轮次统计行。DSH 重渲染可能重建该节点——
     * MutationObserver 在 FilesView 存活期间持续确保标记存在。
     */
    function usePreviewReadingMode(rootRef) {
      React.useEffect(function () {
        var observer = null
        var marked = null
        function apply() {
          var el = rootRef.current
          if (!el) return
          if (marked && marked.contains(el) && marked.getAttribute('data-dsh-soup-preview') === '1') return
          var host = el.parentElement
          while (host) {
            if (host.querySelector && (host.querySelector('[data-composer-seat]') || host.querySelector('.wSkVaW_composerSeat'))) break
            host = host.parentElement
          }
          if (!host) return
          host.setAttribute('data-dsh-soup-preview', '1')
          marked = host
        }
        apply()
        observer = new MutationObserver(function () { apply() })
        observer.observe(document.body, { childList: true, subtree: true })
        return function () {
          if (observer) observer.disconnect()
          if (marked) marked.removeAttribute('data-dsh-soup-preview')
          marked = null
        }
      }, [])
    }

    function FilesView(props) {
      var s = useStore()
      var files = s.files
      var active = files.active ? findFileEntry(files.active) : null
      var rootRef = React.useRef(null)
      usePreviewReadingMode(rootRef)

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
            title: T('explorer.close'),
            onClick: function (e) { e.stopPropagation(); closeFileTab(entry.path) },
          }, '✕'),
        )
      })

      var body = null
      if (!active) {
        body = create('div', { className: 'dfv-empty' },
          create('span', { style: { fontSize: 22 } }, '📄'),
          T('files.emptyHint'),
        )
      } else {
        body = create('div', { className: 'dfv-body' },
          create('div', { className: 'dfv-toolbar' },
            create('span', { className: 'dfv-toolbar-path', title: active.path }, active.path),
            typeof active.size === 'number' && active.size > 0 ? create('span', null, formatBytes(active.size)) : null,
            active.loaded ? create('button', {
              type: 'button',
              className: 'dfv-btn',
              title: T('files.reloadTitle'),
              onClick: function () { reloadFile(active.path) },
            },
              create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }),
              T('files.reload'),
            ) : null,
            create('button', {
              type: 'button',
              className: 'dfv-btn',
              title: '最大化', 'aria-label': '最大化',
              onClick: function () { setFiles({ overlay: true, overlayMax: true, overlayReturn: 'tab' }) },
              dangerouslySetInnerHTML: { __html: EXPAND_SVG },
            }),
          ),
          create(FileContent, { key: active.path, entry: active }),
        )
      }

      return create('div', { className: 'dfv-root', ref: rootRef },
        files.list.length > 0 ? create('div', { className: 'dfv-tabbar' }, tabs) : null,
        body,
      )
    }

    /** 空会话兜底浮层：原生 tab 条不存在时以模态渲染 FileContent。 */
    function PreviewOverlay() {
      var s = useStore()
      var files = s.files
      if (!files.overlay || !files.active) return null
      var active = findFileEntry(files.active)
      if (!active) return null
      var close = function () { setFiles({ overlay: false, overlayMax: false, overlayReturn: null }) }
      var closeAndCloseTab = function () {
        close()
        closeFileTab(active.path)
      }
      var toggleMax = function () {
        if (files.overlayMax && files.overlayReturn === 'tab') {
          // 还原 → 回到 tab 模式
          close()
        } else {
          setFiles({ overlayMax: !files.overlayMax })
        }
      }
      return create('div', {
        className: 'dfv-overlay',
        onClick: function (e) { if (e.target === e.currentTarget) close() },
      },
        create('div', { className: 'dfv-overlay-panel' + (files.overlayMax ? ' dfv-overlay-max' : '') },
          create('div', { className: 'dfv-toolbar' },
            create('span', { className: 'dfv-toolbar-path', title: active.path }, active.path),
            typeof active.size === 'number' && active.size > 0 ? create('span', null, formatBytes(active.size)) : null,
            active.loaded ? create('button', {
              type: 'button',
              className: 'dfv-btn',
              title: T('files.reloadTitle'),
              onClick: function () { reloadFile(active.path) },
            },
              create('span', { className: 'expl-icon', dangerouslySetInnerHTML: { __html: ICON_REFRESH } }),
              T('files.reload'),
            ) : null,
            create('button', {
              type: 'button', className: 'dfv-overlay-close',
              title: files.overlayMax ? '还原' : '最大化', 'aria-label': files.overlayMax ? '还原' : '最大化',
              onClick: toggleMax,
              dangerouslySetInnerHTML: { __html: files.overlayMax ? SHRINK_SVG : EXPAND_SVG },
            }),
            create('button', {
              type: 'button', className: 'dfv-overlay-close',
              title: files.overlayReturn === 'tab' ? '关闭预览 tab' : '关闭',
              'aria-label': files.overlayReturn === 'tab' ? '关闭预览 tab' : '关闭',
              onClick: closeAndCloseTab,
            }, '✕'),
          ),
          create(FileContent, { key: active.path, entry: active }),
        ),
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

    // ------------------------------------------------------------------
    // ▓▓ 区域三 · 速率徽标 · 🧂 盐
    //   输入框上方实时 t/s 吞吐徽标，数据来自 llm/stream 真实流；timerRef 为共享模块级计时引用。
    // ------------------------------------------------------------------
    // 速度徽标：DOM 注入到 Deep diving（role=status）旁。
    // 不改 DSH 源码。用 MutationObserver 定位消息流里的 Deep diving，
    // 把徽标节点 append 进其行内（inline-flex 同行），实现永远紧贴。
    // ------------------------------------------------------------------
    // 模块级 timer 引用：apply(ctx) 里赋值（与 dsh-soup 现有 layout 同款模式）
    var timerRef = null

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

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // ▓▓ 区域四 · 多行 GoalBar · 🧄 蒜
    //   复用原生 goal projection 与动作动词，多行完整展示 + textarea 编辑。
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

    /** 应用浏览器半区：注册会话头部/空白会话切换按钮、details 右列面板、GoalBar、速度徽标。 */
    // ------------------------------------------------------------------
    // ▓▓ 区域五 · 应用注册（apply）
    //   把上述各区域组件注册进 slots / inject；导出插件浏览器半区入口 apply/inject。
    // ------------------------------------------------------------------
    function apply(ctx) {
      var slots = ctx.slots
      layout = ctx.layout
      timerRef = ctx.timer
      var sessions = ctx.sessions
      var remoteGoals = ctx.remote.goals
      var disposers = []
      // i18n：注册双语词典；模块级 T 供组件外回调（菜单/错误横幅）取当前语言文案。
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(function () { return ctx.locale.register(NS, DICT) }, 'dsh-soup: dictionaries')
        if (typeof ctx.locale.bind === 'function') T = ctx.locale.bind(NS)
      }
      // 自动刷新心跳：1s 固定心跳 + 到期才探测（基础 3s；宿主不可达时指数退避，封顶 60s）。
      // 面板关且无预览时 tick 内直接返回（零请求）；首个 tick 只建基线。
      if (timerRef && typeof timerRef.interval === 'function') {
        var stopAuto = timerRef.interval(function () { autoHeartbeat() }, AUTO_HEARTBEAT_MS)
        disposers.push(function () { try { stopAuto() } catch (e) {} })
      }
      slots.inject('conversation.session.header.utilities', function () {
        disposers.push(slots.register(
          { name: 'conversation.session.header.utilities', id: 'dsh-soup-toggle', order: 10, locale: NS, label: function () { return T('explorer.label') } },
          function (props) { return create(HeaderAction, props) },
        ))
      })
      slots.inject('details', function () {
        disposers.push(slots.register(
          // `details` is a single slot occupied by the shell at priority 0.
          // Lower priorities render first, so this intentionally shadows it.
          { name: 'details', priority: -1, locale: NS },
          function (props) {
            return create(React.Fragment, null,
              create(Panel, props),
              create(PreviewOverlay),
            )
          },
        ))
      })
      // 文件标签页：与 对话/轨迹 同级的原生 view tab（ui-trajectory 同款注册方式）。
      // 槽位 entry 是静态的，多文件由 FilesView 内部子 tab 条管理。
      slots.inject('conversation.view', function () {
        disposers.push(slots.register(
          { name: 'conversation.view', id: 'dsh-soup-files', order: 20, locale: NS, label: function () { return T('files.tab') } },
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
          { name: 'conversation.input.dock', id: 'dsh-soup-hero-toggle', order: -10, locale: NS },
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
          { name: 'conversation.input.dock', id: 'dsh-speed-badge', order: 30, locale: NS, label: function () { return T('speed.label') } },
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
