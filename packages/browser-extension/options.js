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
    if (!response || response.error) throw new Error(response?.error || '重试没有返回结果');
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

let displayedQueue = [];
async function refreshOutbox() {
  const result = await chrome.runtime.sendMessage({type:"paperbridge:manage-outbox"});
  if (!result?.ok) throw Error(result?.error || '无法读取待同步记录');
  displayedQueue = result.entries;
  const list = document.querySelector('#outbox-list'); list.replaceChildren();
  document.querySelector('#clear-outbox').disabled = !displayedQueue.length;
  if (!displayedQueue.length) list.textContent = '没有待同步记录';
  for (const entry of displayedQueue) {
    const row = document.createElement('article');
    const text = document.createElement('p'); text.textContent = `${entry.annotation?.document?.title || '论文'}：${entry.reason || '等待同步'}`;
    const quote = document.createElement('p'); quote.textContent = entry.annotation?.selector?.exact || '';
    const remove = document.createElement('button'); remove.textContent = '移除';
    remove.onclick = () => removeOutbox([entry.queueID]); row.append(text,quote,remove); list.append(row);
  }
}
async function removeOutbox(removeIDs) {
  if (!confirm('取消这些尚未同步的本地任务？未同步内容将不再发送，Zotero 已有批注不受影响。')) return;
  try {
    const result = await chrome.runtime.sendMessage({type:'paperbridge:manage-outbox',removeIDs});
    if (!result?.ok) throw Error(result?.error || '清理失败');
    await refreshOutbox(); setStatus('待同步列表已更新','good');
  } catch(error) {setStatus(error.message,'warn');}
}
document.querySelector('#clear-outbox').onclick = () => removeOutbox(displayedQueue.map(entry=>entry.queueID));
chrome.storage.onChanged.addListener(changes => {if(changes.outbox) void refreshOutbox().catch(error=>setStatus(error.message,'warn'));});
void refreshOutbox().catch(error=>setStatus(error.message,'warn'));
