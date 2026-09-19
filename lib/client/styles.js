/**
 * dsh-soup — 浏览器半区静态资源：插件 CSS 与工具栏 SVG 图标。
 * 样式按官方插件约定一次性注入 <style data-plugin-css>，幂等可重复调用。
 */

/** 工具栏图标：刷新图标取自 JupyterLab ui-components（BSD-3-Clause）；
 *  fill 改为 currentColor 以跟随 DSH 主题 token。 */

export var ICON_REFRESH = '<svg xmlns="http://www.w3.org/2000/svg" width="16" viewBox="0 0 18 18"><path fill="currentColor" d="M9 13.5c-2.49 0-4.5-2.01-4.5-4.5S6.51 4.5 9 4.5c1.24 0 2.36.52 3.17 1.33L10 8h5V3l-1.76 1.76A6 6 0 0 0 9 3C5.69 3 3.01 5.69 3.01 9S5.69 15 9 15a5.98 5.98 0 0 0 5.9-5h-1.52c-.46 2-2.24 3.5-4.38 3.5"/></svg>'
export var ICON_NEW_FOLDER = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 7h-3v3h-2v-3h-3v-2h3V8h2v3h3v2z"/></svg>'
export var ICON_MORE = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="13" cy="8" r="1.3" fill="currentColor"/></svg>'
export var FILE_ICON_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
export var FILE_ICON_PREVIEW = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
export var EXPAND_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>'
export var SHRINK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>'

export function injectPluginStyles() {
    // ------------------------------------------------------------------
    // 样式：一次性注入 <style data-plugin>（与官方插件 css 内联约定一致）
    // ------------------------------------------------------------------
    var EXPL_CSS = '.expl-panel{position:relative;height:100%;min-width:300px;max-width:520px;width:100%;display:flex;flex-direction:column;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family);overflow:hidden;box-sizing:border-box;}' +
      '.expl-resize{position:absolute;left:0;top:0;bottom:0;width:7px;cursor:col-resize;z-index:6;touch-action:none;}' +
      '.expl-resize::after{content:"";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:3px;height:40px;border-radius:2px;background:var(--dsw-alias-interactive-bg-hover);opacity:0;transition:opacity .15s;}' +
      '.expl-resize:hover::after{opacity:1;}' +
      /* The official 0.1.5 expand control duplicates dsh-soup's folder
         button; hide it so the explorer has one unambiguous entry point. */
      '[data-sidebar-right-expand],[data-sidebar-right-expand-placeholder]{display:none!important;}' +
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
      '.expl-confirm-mask{position:fixed;inset:0;z-index:2100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);}' +
      '.expl-confirm{width:min(360px,calc(100vw - 32px));padding:18px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3);}' +
      '.expl-confirm-title{font-size:14px;font-weight:600;margin-bottom:10px;}.expl-confirm-text{font-size:13px;line-height:20px;overflow-wrap:anywhere;}.expl-confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}' +
      '.expl-confirm-btn{height:30px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;}.expl-confirm-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}.expl-confirm-primary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:#fff;}' +
      '.expl-menu{position:fixed;z-index:1990;min-width:172px;background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;padding:4px;box-shadow:var(--dsw-shadow-lv3);pointer-events:auto;}' +
      '.expl-menu-item{display:flex;align-items:center;width:100%;text-align:left;background:transparent;border:none;color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 10px;border-radius:8px;cursor:pointer;line-height:1.4;}' +
      '.expl-menu-ico,.expl-menu-ico-ph{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-right:7px;}' +
      '.expl-menu-ico svg{width:14px;height:14px;display:block;}' +
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

    // 文件标签页视图（conversation.view 'dsh-soup-files'）：子 tab 条 + 预览/编辑区。
    // markdown/html/json/csv 有专属渲染器；常见文本文件支持安全编辑保存。
    var FILEVIEW_CSS =
      '.dfv-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);user-select:text;-webkit-user-select:text;}' +
      '.dfv-header{position:sticky;top:0;z-index:2;flex:none;background:var(--dsw-specific-sidebar-fill);}' +
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
      '.dfv-btn:disabled{opacity:.45;cursor:default;}' +
      '.dfv-btn-primary{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);}' +
      '.dfv-status{flex:none;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-warning-primary);}' +
      '.dfv-save-error{flex:none;max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary);}' +
      '.dfv-saved{color:var(--dsw-alias-state-success-primary);}' +
      '.dfv-cm-editor{--dsh-soup-code-cursor:#1f2328;--dsh-soup-code-plain:#1f2328;--dsh-soup-code-comment:#57606a;--dsh-soup-code-keyword:#cf3476;--dsh-soup-code-string:#116329;--dsh-soup-code-number:#953800;--dsh-soup-code-type:#0969da;--dsh-soup-code-variable:#1f2328;--dsh-soup-code-function:#8250df;--dsh-soup-code-property:#0550ae;--dsh-soup-code-punctuation:#57606a;--dsh-soup-code-invalid:#cf222e;--dsh-soup-json-property:#0550ae;--dsh-soup-json-string:#116329;--dsh-soup-json-number:#953800;--dsh-soup-json-literal:#8250df;--dsh-soup-json-punctuation:#57606a;flex:1;min-height:0;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}' +
      'body[data-ds-dark-theme] .dfv-cm-editor{--dsh-soup-code-cursor:#f9fafb;--dsh-soup-code-plain:#f9fafb;--dsh-soup-code-comment:#7d8590;--dsh-soup-code-keyword:#faa2c1;--dsh-soup-code-string:#8ce99a;--dsh-soup-code-number:#ffa94d;--dsh-soup-code-type:#4dabf7;--dsh-soup-code-variable:#f9fafb;--dsh-soup-code-function:#b197fc;--dsh-soup-code-property:#82aaff;--dsh-soup-code-punctuation:#ced4da;--dsh-soup-code-invalid:#ff6b6b;--dsh-soup-json-property:#82aaff;--dsh-soup-json-string:#9ece8f;--dsh-soup-json-number:#e0a96d;--dsh-soup-json-literal:#c792ea;--dsh-soup-json-punctuation:#ced4da;}' +
      '.dfv-cm-editor .cm-editor{height:100%;color:var(--dsh-soup-code-plain);background:transparent;font:12.5px/1.55 var(--ds-font-family-code);}' +
      '.dfv-cm-editor .cm-scroller{overflow:auto;font:inherit;}' +
      '.dfv-cm-editor .cm-content{padding:10px 14px;min-height:calc(100% - 20px);caret-color:var(--dsh-soup-code-cursor);}' +
      '.dfv-cm-editor .cm-cursor{border-left-color:var(--dsh-soup-code-cursor)!important;}' +
      '.dfv-cm-editor .cm-line{padding:0;}' +
      '.dfv-cm-editor .cm-gutters{border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-caption);font:12.5px/1.55 var(--ds-font-family-code);}' +
      '.dfv-cm-editor .cm-gutterElement{box-sizing:content-box;padding:0 8px 0 12px!important;min-width:0!important;}' +
      '.dfv-cm-editor .cm-activeLine,.dfv-cm-editor .cm-activeLineGutter{background:transparent;}' +
      '.dfv-cm-editor .cm-selectionBackground{background:var(--dsw-alias-state-business-primary-hover);}' +
      '.dfv-cm-editor .cm-focused{outline:none;}' +
      '.dfv-editor{flex:1;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;border:none;outline:none;resize:none;overflow:auto;background:transparent;color:var(--dsh-soup-code-plain);caret-color:var(--dsh-soup-code-cursor);font:12.5px/1.55 var(--ds-font-family-code);letter-spacing:normal;text-align:left;text-indent:0;text-transform:none;direction:ltr;white-space:pre;overflow-wrap:normal;word-break:normal;tab-size:2;}' +
      '.dfv-editor::selection{background:var(--dsw-alias-state-business-primary-hover);}' +
      '.dfv-dirty{flex:none;width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-warning-primary);}' +
      '.dfv-error{padding:8px 14px;font-size:12px;color:var(--dsw-alias-state-error-primary);flex:none;}' +
      '.dfv-muted{padding:24px 14px;font-size:13px;color:var(--dsw-alias-label-tertiary);text-align:center;}' +
      '.dfv-cap{padding:5px 14px;font-size:11px;color:var(--dsw-alias-label-caption);border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}' +
      '.dfv-code{flex:1;min-height:0;width:100%;box-sizing:border-box;margin:0;padding:10px 14px;overflow:auto;background:transparent;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55;white-space:pre;tab-size:2;user-select:text;}' +
      '.dfv-code-wrap{flex:1;min-height:0;overflow:auto;padding:8px 10px;}' +
      '.dfv-code-lines{flex:1;min-height:0;display:flex;overflow:auto;}' +
      '.dfv-code-gutter{position:sticky;left:0;z-index:1;flex:none;padding:10px 8px 10px 12px;box-sizing:border-box;text-align:right;color:var(--dsw-alias-label-caption);font-family:var(--ds-font-family-code);font-size:12.5px;line-height:1.55;user-select:none;background:var(--dsw-alias-bg-layer-1);border-right:1px solid var(--dsw-alias-border-l1);}' +
      '.dfv-code-main{flex:1;min-width:0;}' +
      '.dfv-code-main .dfv-code{overflow:visible;width:auto;}' +
      // CodeBlock（md-code-block）在行号布局内的适配：
      // 隐藏 banner（js 标签 + 复制按钮），统一 padding/字体与 gutter 对齐。
      '.dfv-code-main .md-code-block{margin:0;border-radius:0;background:transparent;}' +
      '.dfv-code-main .md-code-block>div:first-child{display:none!important;}' +
      '.dfv-code-main .md-code-block pre{padding:10px 14px!important;margin:0!important;font:12.5px/1.55 var(--ds-font-family-code)!important;background:transparent!important;border-radius:0!important;white-space:pre!important;word-break:normal!important;}' +
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
      '[data-dsh-soup-preview="1"] .FJxK0a_root{display:none !important;}' +
      // 宿主会话文本宽度调整手柄（DSH 0.1.5-rc 起带稳定属性 data-width-handle，
      // left/right 各一个；旧版 hash 类名兜底）。它是给对话正文调宽用的，
      // 预览页里没有对应内容，悬停边缘时不应出现。
      '[data-dsh-soup-preview="1"] [data-width-handle]{display:none !important;}' +
      '[data-dsh-soup-preview="1"] .wSkVaW_widthHandle{display:none !important;}' +
      // Desktop 版的宽度手柄在部分版本中是会话根的相邻节点而非其后代，
      // 上面的作用域选择器覆盖不到。FilesView 存活时会在 body 上设置该状态，
      // 以稳定属性为主全局禁用手柄和它的 hover 指示线。
      'body.dsh-soup-preview-active [data-width-handle]{display:none !important;pointer-events:none !important;}' +
      'body.dsh-soup-preview-active .wSkVaW_widthHandle{display:none !important;pointer-events:none !important;}'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="@lyhue1991/dsh-soup/fileview.css"]') === null) {
      var fileviewTag = document.createElement('style')
      fileviewTag.dataset.plugin = '@lyhue1991/dsh-soup'
      fileviewTag.dataset.pluginCss = '@lyhue1991/dsh-soup/fileview.css'
      fileviewTag.textContent = FILEVIEW_CSS
      document.head.appendChild(fileviewTag)
    }
}
