# Translate Bridge for Zotero 0.8.1

完整包包含 Chrome 扩展 0.8.1 和 Zotero 插件 0.6.1。**同一安装包同时用于 Zotero 9 和 10，无需选择不同版本。**

修复 Zotero 10 上配对成功但 PDF 段落定位与同步一直等待的问题。Zotero 10 的原生读取指令由 `getRecognizerData` 改为 `pdf.getRecognizerData`，译桥现在识别实际接口并选择对应指令；遇到未知接口明确报错。

- PDF 读取使用独立的原生 worker，不再占用 Zotero 的共享 PDF 任务队列；保留全文覆盖与缓存。
- 增加页面读取、全文读取、阅读器打开和浏览器请求超时，避免无限等待。只停止译桥自己创建的 worker。
- 配对测试显示 Zotero 与译桥版本，定位和同步成功后显示耗时。
- 阻止操作进行时的重复点击；切换选段后忽略旧请求的侧栏更新。
- 同步超时且结果不明时，不自动进入重试队列，以免重复生成批注；用户笔记仍保留在侧栏。

更新时两端一起更新：Zotero 从文件安装新 XPI 并完全重启；Chrome 重新加载新扩展目录，再刷新论文页。无需补装 Better Notes、LLM 或 PDF Translate，也无需因本问题降级 Zotero。

Zotero 端已在 Windows 的 9.0.6 与 10.0.3 隔离测试库中检查真实本地 HTTP 请求；29 项自动回归及几何匹配套件通过，覆盖旧/新协议、超时、缓存和选段切换。浏览器端本轮完成逻辑与语法回归，完整浏览器交互尚未完成自动验收。其他 Zotero 小版本及 macOS/Linux 未逐一验证。
