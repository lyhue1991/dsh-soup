# dsh-tree — DSH 项目资源管理器

一个可安装的 DSH（DeepSeek Harness）插件：在会话右侧以**并列网格列**的形式提供项目文件树，与左侧工作区同款配色、同宽（默认 280px，可拖拽 264–420px）。并附带**模型吞吐徽标**：输入框正上方实时显示「正在等待模型...」与彩色 `t/s` 速率徽标。

![screenshot](assets/screenshots/explorer.png)

## 功能

### 资源管理器
- **右侧详情列（details）文件树**：与会话区真正并列（三列网格 `侧栏 | 会话 | 资源管理器`），不悬浮、不遮挡。
- **宽度与左侧工作区完全一致**：默认 280px，拖左边缘在 264–420px 间调整（shell 自带 details 列被硬限制在 300–520px，本插件直接改写网格轨实现同宽）。
- **切换按钮**：会话头部右侧工具区（「Session log」胶囊右侧）一个 📁 图标，点击打开/再点折叠（打开时高亮）。
- **跟随会话**：默认展示当前会话工作目录（`session.header.cwd`），切换会话/工作区自动跟随；路径栏只读展示，不可跳转。
- **文件操作**（右键菜单）：用系统打开、重命名、移到废纸篓、新建文件、新建文件夹、复制路径；空白处右键可刷新。
- **多选**：⌘/Ctrl 加选、Shift 连选；多选时批量移到废纸篓、批量拖拽移动。
- **拖拽**：文件/文件夹拖到目录移动；系统文件拖入上传。
- **交互**：单击选中、双击文件夹展开/收起、双击文件系统打开、⌘ 打开文件、F2/回车/Delete/Escape 等键位习惯（行内重命名选中扩展名前半段）。

### 模型吞吐徽标
- 输入框**正上方居中**显示，运行中（`llm/stream` 流期间）出现、结束后自动消失。
- **等待阶段**：`正在等待模型...` 灰色（与 Deep diving 旁计时同款 `--dsw-alias-label-caption`），省略号 `.`→`..`→`...` 循环。
- **流式阶段**：token 计数（向下箭头）+ 彩色 `xx.x t/s` 徽标（≥50 青 / ≥30 绿 / ≥15 黄 / 其余红）。
- **数据源**：Host 包 `llm/stream` waterfall 实时统计真实 chunk/token（优先 usage 的 `outputTokens`，退化 CJK 字符估算），比浏览器端估算更准。

## 安装

> 需要 DSH Desktop（或支持 `dsh plugin add` 的 DSH 安装）。插件作为 profile bundle 安装。

```sh
# 安装当前版本 0.1.2（npm 包名 @lyhue1991/dsh-tree）
dsh plugin add @lyhue1991/dsh-tree@0.1.2
```

或通过 DSH Desktop「设置 → 插件 → 插件市场」搜索安装。

安装后重启 DSH，在任意会话头部（Session log 右侧）点击 📁 即可打开资源管理器；向任意会话发送消息即可看到吞吐徽标。

## 更新

### 0.1.2

- 修复 details 插槽注册优先级，确保文件树面板正确显示在右侧详情列。
- 修复浏览器半区的布局实例引用，供文件树面板的布局操作正常使用。

## 开发

```sh
git clone https://github.com/lyhue1991/dsh-tree.git
cd dsh-tree
# 纯 JS 产物，无需构建：
#   lib/index.js  —— 宿主半区（webServer 路由 /api/dsh-tree，含 llm/stream 统计）
#   lib/client.js —— 浏览器半区（__ModuleLoader__ 工厂，内联 CSS）
```

`cordis.patch.yml` 在组合中插入一行 `ui-dsh-tree`，`dsh.bundle.patch` 指向它；`dsh.client.inject` 声明浏览器半区依赖的客户端包。

## 实现说明

- **宿主↔浏览器桥梁**：永久插件（profile bundle）不经过 dynamic runner，没有 `harness.handle`/`host.call`；宿主用 `webServer.register({ kind: 'exact', path: '/api/dsh-tree', handler })` 注册同源 HTTP 路由，浏览器用 `fetch` POST JSON 调用（`{ action, args }` 分派）。
- **动作**：`root` / `sessionCwd` / `list` / `open`（`/usr/bin/open`）/ `trash`（Finder osascript）/ `move`（`/bin/mv`）/ `create`（`mkdir -p` / `touch`）/ `upload`（`base64 -D`）/ `speed-status`（返回 `{ phase, tokens, tps, ttft }`）。
- **吞吐统计**：`ctx.on('llm/stream', ...)` 包装 waterfall，按会话（`sessionId`/`agent.id`/`meta` 探测）维护 `{ phase: waiting|streaming|done, tokens, tps, ttft }`；首 chunk 到达标记 streaming（TTFT），结束后 4s 清除；`speed-status` 查询时按流开始累计秒数算平均 t/s（0.5s 暖机）。
- **宽度接管**：MutationObserver 监听 shell 框架的 `grid-template-columns`，把 details 轨改写为插件宽度（264–420px），并在 shell 重渲染后保持；`[data-side="details"]` 隐藏 shell 自带手柄，改用面板左缘自定义拖拽手柄。
- **主题**：全部使用 DSH 主题 token（`--dsw-specific-sidebar-fill`、`--dsw-alias-*` 等），跟随桌面明暗配色。

## 平台

macOS（`/usr/bin/open`、`osascript` 移入废纸篓）。其他平台可 fork 后替换 `lib/index.js` 中对应动作实现。

## 许可证

[MIT](LICENSE)
