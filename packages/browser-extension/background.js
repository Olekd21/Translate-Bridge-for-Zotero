const ZOTERO_BASE_URL = "http://127.0.0.1:23119";
const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "Zotero-Allowed-Request": "1",
  "X-Zotero-Connector-API-Version": "3",
};

async function getSettings() {
  return chrome.storage.local.get({
    pairingToken: "",
    outbox: [],
    reviewArchive: [],
  });
}

async function updateOutboxBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: "#007aff" });
  await chrome.action.setBadgeText({
    text: count > 0 ? String(Math.min(count, 99)) : "",
  });
  await chrome.action.setTitle({
    title:
      count > 0 ? `Translate Bridge for Zotero · ${count} 条等待同步` : "打开 Translate Bridge for Zotero",
  });
}

async function archiveLegacyMatchFailures() {
  const settings = await getSettings();
  const legacyFailures = settings.outbox.filter((entry) =>
    String(entry.reason || "").includes("未找到 DOI 或标题相符的文献条目"),
  );
  if (!legacyFailures.length) return;
  const remaining = settings.outbox.filter(
    (entry) => !legacyFailures.includes(entry),
  );
  await chrome.storage.local.set({
    outbox: remaining,
    reviewArchive: [...settings.reviewArchive, ...legacyFailures].slice(-100),
  });
  await updateOutboxBadge(remaining.length);
}

void archiveLegacyMatchFailures();
void getSettings().then((settings) =>
  updateOutboxBadge(settings.outbox.length),
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});

async function callZotero(path, body, requireToken = false) {
  const { pairingToken } = await getSettings();
  if (requireToken && !pairingToken) {
    const error = new Error("尚未填写 Zotero 配对码。请打开扩展设置完成配对。");
    error.retryable = false;
    throw error;
  }

  const controller = new AbortController();
  const timeoutMs = /\/(annotations|open-selection)$/.test(path) ? 120000 : 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
  const response = await fetch(`${ZOTERO_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      ...(pairingToken ? { "X-Paper-Bridge-Token": pairingToken } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal: controller.signal,
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { ok: false, error: text || `HTTP ${response.status}` };
  }

  if (!response.ok || payload.ok === false) {
    const error = new Error(
      payload.error || `Zotero 返回 HTTP ${response.status}`,
    );
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }
  return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error(path.endsWith('/annotations')
        ? "同步请求超时，保存结果尚不确定。请先检查 Zotero 中是否已生成高亮，避免重复同步。"
        : "Zotero 请求超时，请检查阅读器状态后重试；无需重新输入配对码。");
      timeout.retryable = false;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function enqueue(annotation, reason) {
  const settings = await getSettings();
  const outbox = [
    ...settings.outbox,
    { annotation, reason, queuedAt: new Date().toISOString() },
  ].slice(-100);
  await chrome.storage.local.set({ outbox });
  await updateOutboxBadge(outbox.length);
  return outbox.length;
}

async function syncAnnotation(annotation) {
  try {
    return await callZotero("/paperbridge/annotations", annotation, true);
  } catch (error) {
    if (error?.retryable === false) {
      return {
        ok: false,
        queued: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const queued = await enqueue(
      annotation,
      error instanceof Error ? error.message : String(error),
    );
    return {
      ok: false,
      queued: true,
      outboxCount: queued,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function retryOutbox() {
  const settings = await getSettings();
  const remaining = [];
  let synced = 0;

  for (const entry of settings.outbox) {
    try {
      await callZotero("/paperbridge/annotations", entry.annotation, true);
      synced += 1;
    } catch (error) {
      remaining.push({
        ...entry,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await chrome.storage.local.set({ outbox: remaining });
  await updateOutboxBadge(remaining.length);
  return { ok: remaining.length === 0, synced, remaining: remaining.length };
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "paperbridge:toggle" });
  } catch {
    if (!/^https?:/i.test(tab.url || "")) return;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(tab.id, { type: "paperbridge:toggle" });
    } catch {
      await chrome.action.setTitle({
        tabId: tab.id,
        title: "当前页面无法载入 Translate Bridge for Zotero，请刷新普通论文网页后重试",
      });
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const dispatch = async () => {
    switch (message?.type) {
      case "paperbridge:sync":
        return syncAnnotation(message.annotation);
      case "paperbridge:ping":
        return callZotero("/paperbridge/ping", {}, true);
      case "paperbridge:retry-outbox":
        return retryOutbox();
      case "paperbridge:open-annotation":
        return callZotero("/paperbridge/open", message.target, true);
      case "paperbridge:open-document":
        return callZotero("/paperbridge/open-document", message.locator, true);
      case "paperbridge:open-selection":
        return callZotero(
          "/paperbridge/open-selection",
          message.annotation,
          true,
        );
      default:
        return { ok: false, error: "未知消息" };
    }
  };

  dispatch()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
});
