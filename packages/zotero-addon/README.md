# Translate Bridge for Zotero Zotero 插件

该插件连接 Chrome 中的 Google 翻译阅读与本机 Zotero PDF 批注。安装和依赖说明见 [用户手册](../../docs/用户手册.md)。

插件在 Zotero 本地 HTTP 服务中注册接口，包括：

- `POST /paperbridge/ping`：检测插件是否运行；
- `POST /paperbridge/annotations`：接收网页英文原文锚点、中文译文和个人笔记。

插件先按 DOI（标题为后备）寻找 Zotero 条目，再提取 PDF 文字和坐标，创建原生 PDF 高亮并附上译文和笔记。目前读取前 5 页，支持符合条件的相邻两页选区；匹配不可靠时拒绝写入。

## 构建

```powershell
npm ci
npm run build
```

构建出的 `.xpi` 位于 `.scaffold/build/`。在 Zotero 的“工具 → 插件”中通过齿轮菜单选择“Install Add-on From File”安装。

安装后从 Zotero 的“工具 → Translate Bridge for Zotero → 复制配对码”取得本机配对码，再粘贴到 Chrome 扩展设置页。
