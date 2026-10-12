# Translate Bridge for Zotero · 译桥

**连接 Google 翻译阅读与 Zotero PDF 批注。**

在 Chrome 中用内置 Google 翻译阅读论文网页，选中中文句子，将对应英文原文匹配回本机 Zotero PDF，并同步高亮、中文译文与个人笔记。也支持直接选择英文原文。无需配置 Google 翻译 API 或 AI API key。

[下载最新安装包](https://github.com/Olekd21/Translate-Bridge-for-Zotero/releases/latest) · [安装与用户手册](docs/用户手册.md) · [反馈问题](https://github.com/Olekd21/Translate-Bridge-for-Zotero/issues)

## 最新更新：1.5.5

**改进 Google 翻译句子对应、阅读稳定性，并加入手动本地问题记录。**

- 使用翻译前不可变英文快照，统一句界与 DOM 字符位置；整句容器减少引用、上下标附近的跨句错位，修复句末引用和厂家缩写误断句。继续使用 Chrome 内置 Google 翻译。
- 降低无关页面更新导致的重复扫描和批注请求，保留稳定高亮；改进 Zotero 网页阅读按钮的点击响应。
- 只有主动点击“记录当前问题”才在本地保存错误代码、定位诊断和选区，无需填写原因。支持导出、回访原位置及人工标记复核结果。
- 对 VEGF-C/VEGFR-3 压力超负荷论文的实际 Google 译文，48 段、364 中文选句完成验证：348 句直接对应英文，16 句须明确确认采用完整英文长句；MV3 侧栏回放 412/412 通过。不能将这 16 句算作逐个中文分句直接对齐。

**从 GitHub 1.4.5 或更早版本升级，建议同时更新 Chrome 和 Zotero 到 1.5.5。** 本地已使用 1.5.4 的用户此次仅需更新 Chrome。用新文件覆盖原扩展目录，再点击“重新加载”，不要卸载；旧论文须恢复英文、刷新、重新开启翻译。整句容器可能让文本比原页面更频繁换行。

[更新说明](docs/RELEASE-1.5.5.md) · [验证范围](docs/VALIDATION-1.5.5.md) · [下载 1.5.5 完整安装包](https://github.com/Olekd21/Translate-Bridge-for-Zotero/releases/download/v1.5.5/translate-bridge-for-zotero-1.5.5.zip) · [历史 1.4.5 更新](docs/RELEASE-1.4.5.md)

## 当前能力

- 英文原文直接翻译并同步。
- Chrome 整页翻译后，选择中文完整句子并反查英文定位。
- 在 Zotero PDF 中创建原生高亮，而不是普通条目笔记。
- 中文译文和个人笔记写入同一条 PDF 批注。
- 每条批注可选 8 种 Zotero 高亮颜色。
- 同步成功后可一键打开 Zotero PDF，并定位到刚创建的高亮。
- 可随时一键打开 Zotero 中的整篇 PDF；选择段落后可直接定位到对应页。
- 支持双栏 PDF、断词、单词黏连及不同数字引用格式的长段落定位。
- Zotero 暂时不可用时保留本地待同步队列。

## 安装

在 Releases 下载 `translate-bridge-for-zotero-1.5.5.zip`，解压后打开 `START-HERE.html`。先安装 Zotero 端，再在 Chrome 加载扩展，复制配对码并保存测试。GitHub 自动生成的 Source code ZIP 是源码，请选择完整安装包。

需要同一电脑上的 Zotero 桌面版、Chrome 138+ 以及带文字层的论文 PDF。Zotero Connector 可选；不依赖 Better Notes、LLM-for-Zotero、Zotero PDF Translate、Style 或 Better BibTeX。详细步骤见 [用户手册](docs/用户手册.md)。分发产物位于 `dist/`：

- `translate-bridge-chrome-1.5.5.zip`
- `translate-bridge-zotero-1.5.5.xpi`
- `translate-bridge-for-zotero-1.5.5.zip`（完整安装包）

## 从源码构建与验证

```powershell
npm ci
npm ci --prefix packages/zotero-addon
npm test
npm run check:extension
npm run build:release
python scripts/verify-release.py
```

构建需安装 Node.js、npm 和 Windows PowerShell；安装包校验脚本需 Python 3。普通用户无需安装这些开发工具。Zotero 插件沿用原有 [AGPL-3.0-or-later 许可证](packages/zotero-addon/LICENSE)。

Zotero 端基于 [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) 和 [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit) 构建。内部插件 ID 与配对接口沿用旧名称，以兼容已有安装和配对。

## 已知限制

- Chrome 需要 138 或更高版本。
- PDF 定位覆盖整篇文档；首次同步需读取全文，之后复用本机会话缓存。PDF 更新后自动重新读取。
- 中文反查以完整句子或连续段落最可靠；不可靠时会拒绝写入，避免错误高亮。
- Chrome 扩展尚未上架 Chrome Web Store，需以“加载已解压的扩展程序”方式安装。
