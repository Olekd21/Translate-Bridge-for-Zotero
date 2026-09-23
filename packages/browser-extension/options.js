const tokenInput = document.querySelector("#pairing-token");
const saveButton = document.querySelector("#save");
const retryButton = document.querySelector("#retry");
const statusNode = document.querySelector("#status");
const versionNode = document.querySelector("#version");

function setStatus(text, tone = "neutral") {
  statusNode.textContent = text;
  statusNode.dataset.tone = tone;
}

async function load() {
  const { pairingToken = "", outbox = [] } = await chrome.storage.local.get({
    pairingToken: "",
    outbox: [],
  });
  tokenInput.value = pairingToken;
  versionNode.textContent = `版本 ${chrome.runtime.getManifest().version}`;
  setStatus(
    outbox.length ? `有 ${outbox.length} 条笔记等待同步` : "尚未测试连接",
    outbox.length ? "warn" : "neutral",
  );
}

saveButton.addEventListener("click", async () => {
  const pairingToken = tokenInput.value.trim();
  if (!pairingToken) {
    setStatus("请先粘贴 Zotero 中复制的配对码。", "warn");
    tokenInput.focus();
    return;
  }
  saveButton.disabled = true;
  try {
    await chrome.storage.local.set({ pairingToken });
    setStatus("正在连接 Zotero……");
    const response = await chrome.runtime.sendMessage({
      type: "paperbridge:ping",
    });
    const needsUpdate = response?.ok && !response.capabilities?.fullDocumentGeometry;
    const needsCompatibilityUpdate = response?.ok && Number.parseInt(response.zoteroVersion || '0', 10) >= 10 && !response.capabilities?.pdfProtocol;
    setStatus(
      response?.ok
        ? (needsCompatibilityUpdate
          ? `连接成功，但 PDF 接口不兼容 Zotero ${response.zoteroVersion}。请更新译桥 Zotero 插件。`
          : needsUpdate
          ? `连接成功，但 Zotero 端仍为 ${response.version}，仅支持前 5 页。请安装 0.6.0 或更高版本 XPI 并重启 Zotero。`
          : `连接成功：译桥 ${response.version}${response.zoteroVersion ? ` · Zotero ${response.zoteroVersion}` : ''} · PDF 全文定位${response.capabilities?.isolatedPdfWorker ? ' · 独立读取' : '（建议更新译桥以支持 Zotero 10）'}`)
        : `连接失败：${response?.error || "未知错误"}`,
      response?.ok && !needsUpdate && !needsCompatibilityUpdate ? "good" : "warn",
    );
  } catch (error) {
    setStatus(
      /Extension context invalidated/i.test(String(error))
        ? "扩展刚刚更新，请刷新本设置页后重试。"
        : `连接失败：${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
  } finally {
    saveButton.disabled = false;
  }
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  try {
    setStatus("正在重试……");
    const response = await chrome.runtime.sendMessage({
      type: "paperbridge:retry-outbox",
    });
    setStatus(
      `已同步 ${response.synced || 0} 条，仍有 ${response.remaining || 0} 条等待`,
      response.remaining ? "warn" : "good",
    );
  } catch (error) {
    setStatus(
      `重试失败：${error instanceof Error ? error.message : String(error)}`,
      "warn",
    );
  } finally {
    retryButton.disabled = false;
  }
});

void load();
