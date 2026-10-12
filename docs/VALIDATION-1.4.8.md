# Translate Bridge for Zotero 1.4.8 验证记录

## 本版目标

1. 消除插件在 Zotero PDF 阅读器内持续扫描整页 DOM 造成的卡顿。
2. Zotero 工具栏重绘或条目缓存尚未就绪时，一次点击仍能可靠打开论文网页。
3. 保留 1.4.7 的 Google 翻译轻量句序关联和删除批注划线闪回修复。

## 根因与修复

- 旧版在每个 PDF 阅读器上监听 `documentElement` 的完整子树，同时每 1.5 秒遍历所有阅读器。PDF 页面渲染、滚动和工具栏变化都会触发扫描。
- 1.4.8 改用 Zotero 的 `renderToolbar` 与 `renderTextSelectionPopup` 事件；插件启动时只扫描一次已经打开的阅读器，不再创建全页 MutationObserver 或周期轮询。
- PDF 阅读器按钮在主鼠标 `pointerdown` 时立即登记打开操作，物理点击随后产生的 `click` 被去重；键盘、辅助技术和程序调用仍可通过 `click` 打开。
- 文献列表顶部的 XUL 按钮同时接收 `command` 和 `click`，同一次操作产生的成对事件只执行一次。
- 若阅读器附件尚未进入 Zotero 同步缓存，首次操作会调用 `Zotero.Items.getAsync` 等待条目，再继续解析父文献和网页地址。

## 已完成验证

- Zotero 阅读入口专项测试覆盖：无轮询、无全页观察器、单次 pointerdown+click 只打开一次、工具栏事件重建后仅有一个按钮、未缓存附件首次点击异步取得后打开、XUL click+command 去重、清理不影响其他插件监听器。
- 项目完整自动化回归、Zotero TypeScript 检查、XPI 构建及三个 1.4.8 产物在最终构建后复核。

## 使用与边界

- 必须更新 Zotero 插件 XPI 并完全退出、重新启动 Zotero，旧版阅读器监听器才会从进程中清除。
- Chrome 已为 1.4.7 时可继续使用；完整安装包提供两端同版 1.4.8。无需重新配对。
- 自动测试使用 Zotero API 行为替身验证事件、条目缓存和打开请求；尚未替用户当前 Zotero 窗口执行真实系统浏览器跳转。
- 本版为本地测试包，未自动替换当前安装，也未发布 GitHub。
