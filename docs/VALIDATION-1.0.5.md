# 1.0.5 缓存生命周期修复

用户真实诊断：1.0.4 中选区 95 字符、段落 796 字符、句子标记 18 个，`hasEnglishParagraph=false`、`sentence-cache-missing`。这说明本轮失败发生在缓存恢复，而不是 Zotero 配对；它没有证明具体 DOM 是怎样被替换的。

## 修复与证据

- 支持整段节点被替换后的缓存接回，包括无 ID 段落：所有标记必须属于同一已脱离页面的旧段落、URL 相同、标记全页唯一；不从另一仍在页面上的段落借用缓存。
- 恢复英文后发现不属于当前脚本的旧标记，会移除旧包装并按当前英文重建。
- 新文字或文字修改发生在嵌套行内节点时，检查所属段落；含任何中文的混合文本不再覆盖完整英文快照。
- `scripts/test-cache-lifecycle-browser.js` 验证整段克隆、有/无 ID、旧英文标记、逐句翻译四个场景。用原始 1.0.4 ZIP 中脚本对照，整段克隆路径失败；当前代码四项通过。
- 344 项 DOM 选区矩阵和 13 项句子/诊断测试通过，无 pageerror。跨领域矩阵的中文仍为占位句，不能据此宣称真实 Google 翻译全覆盖。

证据：`.cache/cache-lifecycle-before.txt`、`.cache/cache-lifecycle.txt`、`.cache/sentence-matrix-cachefix.txt`、`.cache/sentence-dom-cachefix.txt`。原先的 `partial-sentence-boundary` 仍需真实边界详情确认，不把缓存修复当作其根因已确认。

1.0.5 为本地候选包，三端版本一致，不含安装器。更新后恢复英文并刷新，再翻译；诊断按钮保留，不需要重新配对。未自动发布 GitHub。
