const bridge = window.arguments?.[0];
const status = document.querySelector("#guide-status");
const actions = [
  [
    "copy-code",
    "copyCode",
    "配对码已复制。请粘贴到 Chrome 的 Translate Bridge for Zotero 设置，点击“保存并测试”。",
  ],
  [
    "open-article",
    "openArticle",
    "已请求打开论文。请在 Chrome 中选择正文并点击 Translate Bridge for Zotero。",
  ],
  ["open-manual", "openManual", "完整用户手册已打开。"],
];
for (const [id, action, message] of actions) {
  const button = document.getElementById(id);
  if (typeof bridge?.[action] !== "function") {
    button.disabled = true;
    status.textContent =
      "这是使用指南预览。安装插件后，从 Zotero 的 Translate Bridge for Zotero 菜单打开，即可配对和阅读。";
    continue;
  }
  button.addEventListener("click", () => {
    try {
      const result = bridge[action]();
      status.textContent =
        result === false
          ? "请先在 Zotero 选中一篇论文，并确认条目中有可用的网址或 DOI。"
          : message;
    } catch {
      status.textContent =
        "未能完成操作。请关闭此窗口，从 Zotero 的 Translate Bridge for Zotero 菜单重新打开指南。";
    }
  });
}
