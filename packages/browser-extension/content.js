(() => {
  const currentVersion = "1.4.5";
  if (window.__paperBridgeVersion === currentVersion) return;
  document.getElementById("paper-bridge-root")?.remove();
  window.__paperBridgeVersion = currentVersion;

  const state = {
    anchor: null,
    translation: "",
    translator: null,
    translating: false,
    mappingInProgress: false,
    syncing: false,
    locating: false,
    color: "#ffd400",
    draftKey: "",
    drafts: new Map(),
    openTarget: null,
    mappingRequestId: 0,
    translationRequestId: 0,
    selectionRange: null,
    sourceParagraphsPromise: null,
    sourceParagraphsUrl: "",
    sourceFetchRetryAt: 0,
    sourceFetchError: "",
  };
  const highlightColors = [
    { value: "#ffd400", label: "黄色" },
    { value: "#ff6666", label: "红色" },
    { value: "#5fb236", label: "绿色" },
    { value: "#2ea8e5", label: "蓝色" },
    { value: "#a28ae5", label: "紫色" },
    { value: "#e56eee", label: "品红" },
    { value: "#f19837", label: "橙色" },
    { value: "#aaaaaa", label: "灰色" },
  ];
  const originalTextByElement = new WeakMap();
  const anchorRanges = new WeakMap();
  const originalTextById = new Map();
  const originalTextBySentence = new WeakMap();
  const sentenceByKey = new Map();
  let nextSentenceKey = 0;
  const textContainerSelector =
    "p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6, div";
  const interactiveTextSelector = 'button, input, textarea, select, [role="button"], [role="textbox"], [contenteditable]:not([contenteditable="false"])';

  const root = document.createElement("div");
  root.id = "paper-bridge-root";
  root.classList.add("notranslate");
  root.setAttribute("translate", "no");
  root.innerHTML = `
    <button class="pb-selection-button" type="button" aria-label="用 Translate Bridge for Zotero 阅读这段文字">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h13M6.5 6.8 3.3 10l3.2 3.2M13.5 6.8l3.2 3.2-3.2 3.2"/></svg>
      <span>翻译并做笔记</span>
    </button>
    <aside id="paper-bridge-panel" class="pb-panel" aria-label="Translate Bridge for Zotero 批注侧栏" data-open="false">
      <div class="pb-resize-handle" role="separator" tabindex="0" aria-orientation="vertical" aria-label="调整侧栏宽度" aria-controls="paper-bridge-panel" title="拖动调整宽度；双击恢复默认；左右方向键微调"></div>
      <header class="pb-header">
        <div class="pb-rail" aria-hidden="true"></div>
        <div class="pb-title-wrap">
          <span class="pb-brandmark" aria-hidden="true">
            <svg viewBox="0 0 36 36"><rect x="1" y="1" width="34" height="34" rx="10"/><path d="M8.5 23.5c2.6-7.2 7.2-10.8 9.5-10.8s6.9 3.6 9.5 10.8M9 20.8v5.1M27 20.8v5.1"/></svg>
          </span>
          <span>
            <span class="pb-kicker">Source ↔ Zotero · ${currentVersion}</span>
            <span class="pb-title">Translate Bridge for Zotero</span>
          </span>
        </div>
        <button class="pb-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="pb-body">
        <div class="pb-reading-scroll">
          <div class="pb-document"></div>
          <div class="pb-empty">先在论文中选择一句或一段文字。扩展会保留英文定位，再生成中文译文。</div>
          <section class="pb-card pb-scope-proposal" hidden>
            <p>这段译文把一个英文原句拆成了多句，所选内容可能对应分开的英文片段。可采用下面的完整原句范围：</p>
            <p class="pb-scope-original"></p>
            <p class="pb-scope-translation"></p>
            <button class="pb-action pb-use-source-sentence" type="button">按完整英文原句定位</button>
          </section>
          <section class="pb-card pb-source-card" data-expanded="false" hidden>
            <div class="pb-card-head">
              <span class="pb-label">PDF 定位原文</span>
              <span class="pb-card-state">英文锚点</span>
            </div>
            <p class="pb-source"></p>
            <button class="pb-expand pb-source-expand" type="button" hidden>展开原文</button>
          </section>
          <section class="pb-card pb-translation-card" data-expanded="false" hidden>
            <div class="pb-card-head">
              <span class="pb-label">中文阅读层</span>
              <span class="pb-card-state">阅读译文</span>
            </div>
            <p class="pb-translation"></p>
            <details class="pb-scope-notice" hidden open>
              <summary>已采用完整英文原句范围</summary>
              <p class="pb-scope-selected"></p>
              <p class="pb-scope-added"></p>
            </details>
            <button class="pb-expand pb-translation-expand" type="button" hidden>展开译文</button>
          </section>
        </div>
        <div class="pb-dock">
          <label class="pb-note-wrap" hidden>
            <span class="pb-note-head"><span class="pb-label">我的笔记</span><span class="pb-shortcut">Ctrl + Enter 同步</span></span>
            <textarea class="pb-note" placeholder="记录判断、疑问或与课题的联系……"></textarea>
          </label>
          <div class="pb-color-wrap" hidden>
            <div class="pb-color-head">
              <span class="pb-label">高亮颜色</span>
              <span class="pb-color-name">黄色</span>
            </div>
            <div class="pb-color-options" role="radiogroup" aria-label="选择 Zotero 高亮颜色">
              ${highlightColors
                .map(
                  ({ value, label }) =>
                    `<button class="pb-color" type="button" role="radio" aria-label="${label}" aria-checked="${value === state.color}" data-color="${value}" data-label="${label}" style="--pb-swatch:${value}"><span></span></button>`,
                )
                .join("")}
            </div>
          </div>
          <div class="pb-open-actions" aria-label="在 Zotero 中打开">
            <button class="pb-action pb-action-document pb-open-document" type="button">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 3.8h7l4 4v8.4H4.5zM11.5 3.8v4h4M7 11h6M7 13.8h4"/></svg><span>打开这篇文章</span>
            </button>
            <button class="pb-action pb-action-open pb-open-selection" type="button" disabled title="选择一段文字后可定位">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.2H4.8c-.5 0-.8.4-.8.8v10.2c0 .5.3.8.8.8H15c.4 0 .8-.3.8-.8v-2.7M10 10l6-6m0 0h-4m4 0v4"/></svg><span>打开选中段落</span>
            </button>
          </div>
          <div class="pb-actions" hidden>
            <button class="pb-action pb-action-secondary pb-translate" type="button">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.4 6.4A6.4 6.4 0 1 0 16 13M15.4 6.4V2.8m0 3.6h-3.6"/></svg><span>翻译成中文</span>
            </button>
            <button class="pb-action pb-action-primary pb-sync" type="button">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 14.8V3.5m0 0L6.5 7M10 3.5 13.5 7M4 11.5v4.2c0 .5.4.8.8.8h10.4c.4 0 .8-.3.8-.8v-4.2"/></svg><span>同步到 Zotero</span>
            </button>
          </div>
          <div class="pb-status" aria-live="polite">等待选择原文</div>
          <div class="pb-diagnostic-actions">
            <button class="pb-action pb-diagnostics" type="button" hidden>复制定位诊断</button>
            <button class="pb-action pb-boundary-details" type="button" hidden>复制边界详情（含当前句子）</button>
          </div>
        </div>
      </div>
    </aside>`;
  document.documentElement.appendChild(root);

  function normalizedReadableText(value) {
    return String(value || "")
      .replace(/<\s*\/?\s*(?:sup|sub|em|strong|i|b)\s*>/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function looksPrimarilyEnglish(value) {
    const text = normalizedReadableText(value);
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
    return latinCount >= 20 && cjkCount <= Math.max(2, latinCount * 0.03);
  }

  function isPdfAnchorReady(anchor) {
    return (
      !anchor?.selectionIssue &&
      anchor?.selectedLanguage === "en" &&
      /[A-Za-z]{2}/.test(anchor.exact) &&
      !/[\u3400-\u9fff]/.test(anchor.exact)
    );
  }

  function rememberEnglishContainers(scope = document) {
    // Mutation records can refer to text detached before observer delivery.
    // Skip it without aborting the rest of the batch of valid paragraphs.
    if (!scope || !scope.isConnected) return;
    const candidates = [
      ...(scope.closest?.(textContainerSelector) ? [scope.closest(textContainerSelector)] : []),
      ...(scope.matches?.(textContainerSelector) ? [scope] : []),
      ...Array.from(scope.querySelectorAll?.(textContainerSelector) || []),
    ];
    for (const element of candidates) {
      if (root.contains(element) || !isTextContainer(element)) continue;
      const text = normalizedReadableText(element.textContent);
      // Never overwrite a complete English snapshot with a partially translated
      // paragraph merely because most of its characters are still Latin.
      if (looksPrimarilyEnglish(text) && !/[\u3400-\u9fff]/.test(text)) {
        originalTextByElement.set(element, {
          url: location.href.split("#")[0],
          text,
        });
        if (element.id && originalTextById.size < 5000)
          originalTextById.set(
            `${location.href.split("#")[0]}#${element.id}`,
            text,
          );
        if (document.readyState !== "loading") preserveSentenceBoundaries(element);
      }
    }
  }

  rememberEnglishContainers();
  document.addEventListener("DOMContentLoaded", () => rememberEnglishContainers(), { once: true });
  new MutationObserver((records) => {
    for (const record of records) {
      if (root.contains(record.target)) continue;
      if (record.type === "characterData") {
        rememberEnglishContainers(record.target.parentElement);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE)
          rememberEnglishContainers(node);
        else if (node.nodeType === Node.TEXT_NODE)
          rememberEnglishContainers(node.parentElement);
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  const button = root.querySelector(".pb-selection-button");
  const panel = root.querySelector(".pb-panel");
  setupPanelResize();

  function setupPanelResize() {
    const handle = panel.querySelector(".pb-resize-handle");
    const defaultWidth = 440;
    let preferredWidth = defaultWidth;
    let interacted = false;
    let drag = null;
    let saveWidth = Promise.resolve();

    function widthBounds() {
      const viewport = window.innerWidth;
      return viewport <= 600
        ? { min: viewport, max: viewport }
        : { min: 400, max: Math.max(400, Math.min(960, Math.floor(viewport * 0.8))) };
    }

    function renderWidth() {
      const { min, max } = widthBounds();
      const width = Math.round(Math.max(min, Math.min(max, preferredWidth)));
      panel.style.setProperty("--pb-panel-width", `${width}px`);
      handle.setAttribute("aria-valuemin", String(min));
      handle.setAttribute("aria-valuemax", String(max));
      handle.setAttribute("aria-valuenow", String(width));
      handle.setAttribute("aria-valuetext", `${width} 像素`);
      handle.setAttribute("aria-disabled", String(min === max));
      handle.tabIndex = min === max ? -1 : 0;
    }

    function changeWidth(width) {
      const { min, max } = widthBounds();
      preferredWidth = Math.round(Math.max(min, Math.min(max, width)));
      interacted = true;
      renderWidth();
    }

    function persistWidth() {
      const panelWidth = preferredWidth;
      saveWidth = saveWidth
        .then(() => chrome.storage.local.set({ panelWidth }))
        .catch(() => undefined);
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || drag || widthBounds().min === widthBounds().max) return;
      event.preventDefault();
      interacted = true;
      drag = { id: event.pointerId, x: event.clientX, width: panel.getBoundingClientRect().width, previous: preferredWidth };
      handle.setPointerCapture(event.pointerId);
      panel.dataset.resizing = "true";
    });
    handle.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      changeWidth(drag.width + drag.x - event.clientX);
    });
    function endDrag(event) {
      if (drag?.id !== event.pointerId) return;
      if (event.type === "pointerup") persistWidth();
      else preferredWidth = drag.previous;
      drag = null;
      delete panel.dataset.resizing;
      renderWidth();
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(type, endDrag);
    handle.addEventListener("dblclick", () => {
      changeWidth(defaultWidth);
      persistWidth();
    });
    handle.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const { min, max } = widthBounds();
      if (min === max) return;
      const width = panel.getBoundingClientRect().width;
      const next = { ArrowLeft: width + 20, ArrowRight: width - 20, Home: min, End: max }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      changeWidth(next);
      persistWidth();
    });
    function fitViewport() {
      if (!root.isConnected) {
        window.removeEventListener("resize", fitViewport);
        return;
      }
      // A temporary narrow window must not replace the saved desktop width.
      renderWidth();
    }
    window.addEventListener("resize", fitViewport);
    renderWidth();
    void chrome.storage.local.get({ panelWidth: defaultWidth }).then(({ panelWidth }) => {
      if (interacted || !Number.isFinite(panelWidth)) return;
      preferredWidth = Math.max(400, Math.min(960, panelWidth));
      renderWidth();
    }).catch(() => undefined);
  }

  const closeButton = root.querySelector(".pb-close");
  const documentLine = root.querySelector(".pb-document");
  const empty = root.querySelector(".pb-empty");
  const sourceCard = root.querySelector(".pb-source-card");
  const sourceLabel = sourceCard.querySelector(".pb-label");
  const sourceState = sourceCard.querySelector(".pb-card-state");
  const sourceNode = root.querySelector(".pb-source");
  const sourceExpand = root.querySelector(".pb-source-expand");
  const translationCard = root.querySelector(".pb-translation-card");
  const translationState = translationCard.querySelector(".pb-card-state");
  const translationNode = root.querySelector(".pb-translation");
  const translationExpand = root.querySelector(".pb-translation-expand");
  const noteWrap = root.querySelector(".pb-note-wrap");
  const noteNode = root.querySelector(".pb-note");
  const colorWrap = root.querySelector(".pb-color-wrap");
  const colorName = root.querySelector(".pb-color-name");
  const colorButtons = Array.from(root.querySelectorAll(".pb-color"));
  const actions = root.querySelector(".pb-actions");
  const translateButton = root.querySelector(".pb-translate");
  const translateButtonLabel = translateButton.querySelector("span");
  const syncButton = root.querySelector(".pb-sync");
  const openDocumentButton = root.querySelector(".pb-open-document");
  const openSelectionButton = root.querySelector(".pb-open-selection");
  const statusNode = root.querySelector(".pb-status");
  const diagnosticsButton = root.querySelector(".pb-diagnostics");
  const boundaryDetailsButton = root.querySelector(".pb-boundary-details");
  let diagnosticCopyRequest = 0;
  let diagnosticResetTimer;
  function resetDiagnosticButtons() {
    diagnosticCopyRequest += 1;
    clearTimeout(diagnosticResetTimer);
    diagnosticsButton.textContent = "复制定位诊断";
    boundaryDetailsButton.textContent = "复制边界详情（含当前句子）";
    diagnosticsButton.disabled = boundaryDetailsButton.disabled = false;
  }

  function setStatus(text, tone = "neutral", diagnosticError = tone === "warn") {
    statusNode.textContent = text;
    statusNode.dataset.tone = tone;
    diagnosticsButton.hidden = !diagnosticError || state.anchor?.selectedLanguage !== "zh";
    boundaryDetailsButton.hidden = diagnosticsButton.hidden;
    if (tone === "warn") requestAnimationFrame(() => {
      if (statusNode.dataset.tone === "warn") {
        const dock = root.querySelector(".pb-dock");
        dock.scrollTop = dock.scrollHeight;
      }
    });
  }

  function updateTextAction() {
    const isChineseSelection = state.anchor?.selectedLanguage === "zh";
    const isTranslatedWorkflow =
      isChineseSelection || state.anchor?.selectionMode === "translated";
    if (isTranslatedWorkflow) {
      translateButtonLabel.textContent = state.mappingInProgress
        ? "匹配中…"
        : isChineseSelection
          ? "匹配英文原文"
          : "重新匹配原文";
      translateButton.title = "重新查找这段中文对应的英文 PDF 原文";
      translateButton.disabled = !state.anchor || state.mappingInProgress;
      return;
    }
    translateButtonLabel.textContent = state.translating
      ? "翻译中…"
      : state.translation
        ? "重新翻译"
        : "翻译成中文";
    translateButton.title = "使用 Chrome 本地翻译生成中文阅读层";
    translateButton.disabled = !state.anchor || state.translating;
  }

  function setHighlightColor(color, persist = true) {
    const selected =
      highlightColors.find((candidate) => candidate.value === color) ||
      highlightColors[0];
    state.color = selected.value;
    colorName.textContent = selected.label;
    root.style.setProperty("--pb-selected-color", selected.value);
    for (const colorButton of colorButtons) {
      colorButton.setAttribute(
        "aria-checked",
        String(colorButton.dataset.color === selected.value),
      );
    }
    if (persist) {
      void chrome.storage.local
        .set({ highlightColor: selected.value })
        .catch(() => undefined);
    }
  }

  function anchorDraftKey(anchor) {
    if (!anchor?.exact) return "";
    return `${location.origin}${location.pathname}::${anchor.exact}`;
  }

  function saveCurrentDraft() {
    if (!state.draftKey) return;
    state.drafts.set(state.draftKey, noteNode.value);
  }

  function activateAnchor(anchor) {
    if (!anchor || anchor === state.anchor) return;
    resetDiagnosticButtons();
    diagnosticsButton.hidden = boundaryDetailsButton.hidden = true;
    saveCurrentDraft();
    state.mappingRequestId += 1;
    state.mappingInProgress = false;
    state.translationRequestId += 1;
    state.translating = false;
    state.anchor = anchor;
    state.selectionRange = anchorRanges.get(anchor)?.cloneRange() || null;
    state.translation = "";
    state.openTarget = null;
    state.draftKey = anchorDraftKey(anchor);
    noteNode.value = state.drafts.get(state.draftKey) || "";
  }

  void chrome.storage.local
    .get({ highlightColor: state.color })
    .then(({ highlightColor }) => setHighlightColor(highlightColor, false))
    .catch(() => setHighlightColor(state.color, false));

  function refreshExpansionControls(reset = false) {
    const cards = [
      [sourceCard, sourceNode, sourceExpand, "展开原文"],
      [translationCard, translationNode, translationExpand, "展开译文"],
    ];
    for (const [card, textNode, expandButton, label] of cards) {
      if (reset) card.dataset.expanded = "false";
      const canExpand =
        normalizedReadableText(textNode.textContent).length > 360;
      card.dataset.collapsible = String(canExpand);
      expandButton.hidden = !canExpand;
      expandButton.textContent =
        card.dataset.expanded === "true" ? "收起" : label;
    }
  }

  function toggleCard(card, buttonNode, collapsedLabel) {
    const expanded = card.dataset.expanded !== "true";
    card.dataset.expanded = String(expanded);
    buttonNode.textContent = expanded ? "收起" : collapsedLabel;
  }

  function isTextContainer(element) {
    if (!element?.matches?.(textContainerSelector)) return false;
    if (element.closest(interactiveTextSelector)) return false;
    const semantic =
      "p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6";
    if (element.tagName !== "DIV") return !element.querySelector(semantic);
    if (element.parentElement?.closest(semantic)) return false;
    // A flat div is a common publisher paragraph. Never treat an entire
    // article/section containing other blocks as one paragraph.
    return !element.querySelector(textContainerSelector);
  }

  function nearestTextContainer(node) {
    let element =
      node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (element && element !== document.body) {
      if (isTextContainer(element)) return element;
      element = element.parentElement;
    }
    return node?.parentElement || document.body;
  }

  function findHeading(element) {
    let current = element;
    while (current && current !== document.body) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName)) return capturedOriginal(sibling) || sibling.textContent.trim();
        const nested = sibling.querySelector?.("h1, h2, h3, h4, h5, h6");
        if (nested?.textContent?.trim()) return capturedOriginal(nested) || nested.textContent.trim();
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return "";
  }

  function extractDoi() {
    const selectors = [
      'meta[name="citation_doi"]',
      'meta[name="dc.identifier"]',
      'meta[name="DC.Identifier"]',
      'meta[property="og:doi"]',
    ];
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.content?.trim();
      const match = value?.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
      if (match) return match[0].replace(/[.)]+$/, "").toLowerCase();
    }

    const canonical =
      document.querySelector('link[rel="canonical"]')?.href || location.href;
    return (
      canonical
        .match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0]
        ?.replace(/[.)]+$/, "")
        .toLowerCase() || ""
    );
  }

  function capturedOriginal(element) {
    const url = location.href.split("#")[0];
    let saved = originalTextByElement.get(element);
    // A publisher or translator can replace the whole paragraph, not just a
    // sentence span. Adopt only a complete, unique set from one detached owner.
    const spans = [...element.querySelectorAll("[data-pb-sentence]")];
    const records = spans.map(span => sentenceByKey.get(span.dataset.pbSentence));
    const owner = records[0]?.paragraph;
    if (owner && owner !== element && !owner.isConnected && records.every(record => record?.paragraph === owner && record.url === url) &&
        spans.every(span => document.querySelectorAll(`[data-pb-sentence="${CSS.escape(span.dataset.pbSentence)}"]`).length === 1)) {
      const previous = originalTextByElement.get(owner);
      if (previous?.url === url) {
        originalTextByElement.set(element, previous);
        saved = previous;
        for (const record of records) record.paragraph = element;
      }
    }
    if (saved?.url === url) return saved.text;
    if (element.id && document.querySelectorAll(`[id="${CSS.escape(element.id)}"]`).length === 1)
      return originalTextById.get(`${url}#${element.id}`) || "";
    return "";
  }

  function englishSentenceSegments(raw) {
    // Intl treats some abbreviation periods as sentence endings, especially
    // inside parentheses: "(Extended Data Fig. 4).". Protect only evidenced
    // continuations, using equal-length substitutions to retain DOM offsets.
    const protectedPeriods = new Set();
    const protect = pattern => {
      for (const match of raw.matchAll(pattern)) {
        for (let i = 0; i < match[0].length; i++)
          if (match[0][i] === ".") protectedPeriods.add(match.index + i);
      }
    };
    protect(/\b(?:figs?|eqs?|refs?|secs?|chap(?:s)?)\.(?=\s*(?:S?\d|[IVXLC]+\b))/gi);
    protect(/\b(?:nos?|vols?|pp?)\.(?=\s*\d)/gi);
    protect(/\b(?:e\.g|i\.e)\./gi);
    protect(/\b(?:vs|cf|viz)\.(?=\s+\S)/gi);
    protect(/\b(?:Dr|Prof|Mr|Mrs|Ms)\.(?=\s+[A-Z][a-z])/g);
    // "et al." can also end a real sentence. An uppercase following sentence
    // remains a boundary; a year/citation or lowercase continuation does not.
    protect(/\bet\s+al\.(?=\s*(?:\(?\d|[a-z]))/g);
    // Keep sentence-final references with the preceding sentence. Intl may
    // otherwise split inside "increased.[12,13] The control...". Restore the
    // real boundary AFTER the reference, never inside a protected abbreviation.
    const citations = /(?<=[a-z)])[.!?](?:\[\s*\d+(?:\s*[,–−-]\s*\d+)*\s*\]|\d+(?:\s*[,–−-]\s*\d+)*)\s+(?=[A-Z][a-z])/g;
    const citationBreaks = [...raw.matchAll(citations)].filter(match => !protectedPeriods.has(match.index));
    const masked = new Set([...protectedPeriods, ...citationBreaks.map(match => match.index)]);
    const segmentationText = raw.replace(/[.!?]/g, (period, index) => masked.has(index) ? "\u2060" : period);
    const base = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(segmentationText), part => ({
      index: part.index, segment: raw.slice(part.index, part.index + part.segment.length),
    }));
    return base.flatMap(part => {
      const cuts = [0];
      for (const match of citationBreaks) {
        const cut = match.index + match[0].length - part.index;
        if (cut > 0 && cut < part.segment.length) cuts.push(cut);
      }
      cuts.push(part.segment.length);
      return cuts.slice(0,-1).filter((start,i)=>start<cuts[i+1]).map((start,i)=>({
        index:part.index+start, segment:part.segment.slice(start,cuts[i+1]),
      }));
    });
  }

  function preserveSentenceBoundaries(element) {
    // Keep an actual English sentence attached to its DOM range before Chrome
    // translates it. No sentence-order or translation-similarity guess is used.
    if (!("Segmenter" in Intl)) return;
    if (element.closest("nav, header, footer, [contenteditable=true]") ||
        element.querySelector("script, style, pre, code, svg, input, textarea")) return;
    const raw = element.textContent;
    if (!looksPrimarilyEnglish(raw) || raw.length > 20000) return;
    const existing = [...element.querySelectorAll("[data-pb-sentence]")];
    if (existing.length) {
      if (existing.every(span => sentenceByKey.get(span.dataset.pbSentence)?.paragraph === element)) return;
      // English was restored with stale markers from an earlier script. Rebuild
      // from the actual English text instead of permanently skipping this block.
      for (const span of existing.reverse()) span.replaceWith(...span.childNodes);
    }
    const segments = englishSentenceSegments(raw);
    if (segments.length < 1 || segments.length > 100) return;
    const texts = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      texts.push({ node, start: offset, end: offset + node.length });
      offset += node.length;
    }
    // Work backwards so earlier text offsets remain valid after extraction.
    for (const segment of segments.reverse()) {
      // Whitespace belongs between sentences, not inside the last inline
      // ancestor. Including it needlessly crosses publisher ID boundaries.
      const start = segment.index + segment.segment.length - segment.segment.trimStart().length;
      const end = segment.index + segment.segment.trimEnd().length;
      const first = texts.find(t => t.end > start);
      const last = texts.find(t => t.end >= end && t.start < end);
      if (!first || !last || !segment.segment.trim()) continue;
      const range = document.createRange();
      range.setStart(first.node, start - first.start);
      range.setEnd(last.node, end - last.start);
      if (first.node.parentElement.closest(interactiveTextSelector) ||
          last.node.parentElement.closest(interactiveTextSelector) ||
          range.cloneContents().querySelector(interactiveTextSelector)) continue;
      // Do not split an inline element with an ID: cloning that boundary could
      // create duplicate publisher link targets. Fall back to paragraph cache.
      const splitsIdentifiedElement = (node) => {
        // extractContents only clones partially selected ancestors below the
        // range's common ancestor. An ID on that ancestor is retained intact.
        const common = range.commonAncestorContainer;
        if (common.nodeType === Node.TEXT_NODE) return false;
        for (let parent = node.parentElement; parent && parent !== common && parent !== element; parent = parent.parentElement)
          if (parent.id) return true;
        return false;
      };
      if (splitsIdentifiedElement(first.node) || splitsIdentifiedElement(last.node)) continue;
      if (sentenceByKey.size >= 20000) return;
      const span = document.createElement("span");
      span.dataset.pbSentence = String(++nextSentenceKey);
      span.appendChild(range.extractContents());
      range.insertNode(span);
      const saved = {
        url: location.href.split("#")[0],
        text: normalizedReadableText(segment.segment),
        paragraph: element,
      };
      originalTextBySentence.set(span, saved);
      sentenceByKey.set(span.dataset.pbSentence, saved);
    }
  }

  function sentenceRecord(span, element) {
    let saved = originalTextBySentence.get(span);
    if (!saved) {
      const key = span.dataset.pbSentence;
      const keyed = sentenceByKey.get(key);
      if (keyed?.paragraph === element &&
          element.querySelectorAll(`[data-pb-sentence="${CSS.escape(key)}"]`).length === 1) saved = keyed;
    }
    return saved?.paragraph === element && saved.url === location.href.split("#")[0] ? saved : null;
  }

  function sentenceGroups(element, spans, originalParagraph, diagnostic = {}) {
    // A key identifies a source sentence, not a translated physical node.
    // Adopt clones only as one contiguous, source-ordered group. Never grant
    // each gene/link fragment the full English sentence on its own.
    if (!spans.length || !originalParagraph) return null;
    const groups = [], seen = new Set();
    const reject = (reason, span) => {
      diagnostic.fragmentGroupFailure = { reason, marker: span.dataset.pbSentence };
      return null;
    };
    for (const span of spans) {
      const key = span.dataset.pbSentence, saved = sentenceByKey.get(key);
      if (!saved) return reject("unknown-key", span);
      if (saved.paragraph !== element) return reject("foreign-owner", span);
      if (saved.url !== location.href.split("#")[0]) return reject("stale-url", span);
      if (span.querySelector("[data-pb-sentence]")) return reject("nested-markers", span);
      const at = originalParagraph.indexOf(saved.text);
      if (at < 0 || originalParagraph.indexOf(saved.text, at + 1) >= 0) return reject("ambiguous-source", span);
      // Only real reference links (or empty translator clones) may intervene.
      const fragmentRange = document.createRange(); fragmentRange.selectNodeContents(span);
      if (!normalizedReadableText(selectionWithoutReferences(fragmentRange, true))) continue;
      if (groups.at(-1)?.key === key) {
        groups.at(-1).last = span; groups.at(-1).fragments.push(span);
      } else {
        if (seen.has(key) || (groups.length && at < groups.at(-1).sourceEnd)) {
          const repaired = interleavedSentenceGroups(element, spans, originalParagraph);
          if (repaired) { diagnostic.mappingEvidence = "sentence-text-marker-consensus"; return repaired; }
          return reject(seen.has(key) ? "noncontiguous-key" : "source-order", span);
        }
        seen.add(key);
        groups.push({key, span, last:span, saved, sourceStart:at,
          sourceEnd:at + saved.text.length, fragments:[span]});
      }
    }
    for (const group of groups) {
      group.range = document.createRange();
      group.range.setStartBefore(group.span); group.range.setEndAfter(group.last);
      const covered = group.fragments.map(span => {
        const range = document.createRange(); range.selectNodeContents(span);
        return selectionWithoutReferences(range, true);
      });
      const groupedText = selectionWithoutReferences(group.range);
      // Normalize after joining: a comma, time separator or prime can sit in
      // its own translator clone and acquire meaning from adjacent fragments.
      const coveredText = coverageKey(covered.join(""));
      if (coveredText !== groupedText) {
        // Keep unrelated, validated sentences usable. This group remains unsafe
        // and cannot participate in boundary repair or source recovery.
        group.failure = {reason:"unmarked-content", marker:group.key,
          coveredText:coveredText.slice(0,2000), rangeText:groupedText.slice(0,2000)};
      }
      // Duplicated complete translations are not fragments. Short repeated
      // scientific tokens such as Flt4 remain valid within the same sentence.
      const complete = group.fragments.map(span => normalizedReadableText(span.textContent))
        .filter(text => /[。！？]/u.test(text) && compactChinese(text).length > 8);
      if (new Set(complete.map(compactChinese)).size !== complete.length) return reject("duplicated-translation", group.span);
    }
    return groups.length ? groups : null;
  }

  function interleavedSentenceGroups(element, spans, originalParagraph) {
    // Chrome sometimes lends a neighbouring key to a few words inside a
    // sentence (A, B, A). Recover only complete Chinese sentences with strong
    // marker agreement, full coverage and monotonically ordered source keys.
    // Sentence counts alone, or globally sorting DOM nodes by key, are unsafe.
    const records = new Map();
    for (const span of spans) {
      const key = span.dataset.pbSentence, saved = sentenceByKey.get(key);
      if (!saved || saved.paragraph !== element || saved.url !== location.href.split("#")[0] ||
          span.querySelector('[data-pb-sentence]')) return null;
      const at = originalParagraph.indexOf(saved.text);
      if (at < 0 || originalParagraph.indexOf(saved.text, at + 1) >= 0 ||
          englishSentenceSegments(saved.text).length !== 1) return null;
      records.set(key, {saved, sourceStart:at, sourceEnd:at + saved.text.length});
    }
    const whole = document.createRange(); whole.selectNodeContents(element);
    const raw = whole.toString(), groups = [], seen = new Set();
    const units = [...raw.matchAll(/[^。！？]+[。！？][”’」』）)\]]*/gu)];
    if (!units.length) return null;
    const tailStart = units.at(-1).index + units.at(-1)[0].length;
    const tail = tailStart < raw.length && sliceTextRange(whole, tailStart, raw.length);
    if (tail && selectionWithoutReferences(tail)) return null;
    for (const unit of units) {
      const range = sliceTextRange(whole, unit.index, unit.index + unit[0].length);
      if (!range) return null;
      const weights = new Map(), contributing = [], covered = [];
      for (const span of spans) {
        const clipped = document.createRange(); clipped.selectNodeContents(span);
        if (clipped.compareBoundaryPoints(Range.END_TO_START, range) >= 0 ||
            clipped.compareBoundaryPoints(Range.START_TO_END, range) <= 0) continue;
        if (clipped.compareBoundaryPoints(Range.START_TO_START, range) < 0) clipped.setStart(range.startContainer,range.startOffset);
        if (clipped.compareBoundaryPoints(Range.END_TO_END, range) > 0) clipped.setEnd(range.endContainer,range.endOffset);
        covered.push(selectionWithoutReferences(clipped, true));
        const text = selectionWithoutReferences(clipped);
        if (!text) continue;
        const key = span.dataset.pbSentence;
        weights.set(key, (weights.get(key) || 0) + text.length);
        contributing.push(span);
      }
      const text = selectionWithoutReferences(range);
      if (!text || coverageKey(covered.join('')) !== text) return null;
      const votes = [...weights].sort((a,b)=>b[1]-a[1]);
      const [key, count] = votes[0];
      if (count / text.length < 0.7 || (votes[1] && count - votes[1][1] < 8)) return null;
      const record = records.get(key), previous = groups.at(-1);
      if (previous?.key === key) {
        if (compactChinese(previous.range.toString()) === compactChinese(range.toString())) return null;
        previous.range.setEnd(range.endContainer, range.endOffset);
        previous.fragments.push(...contributing); previous.last = contributing.at(-1);
      } else {
        if (seen.has(key) || (previous && record.sourceStart < previous.sourceEnd)) return null;
        seen.add(key);
        groups.push({key,...record,span:contributing.find(s=>s.dataset.pbSentence===key),
          last:contributing.at(-1),fragments:contributing,range});
      }
    }
    // Each captured source sentence must retain its own substantive translation;
    // a missing or collapsed sentence cannot be inferred from neighbouring keys.
    if (groups.length !== records.size || groups.some((group,i)=>i && originalParagraph.slice(groups[i-1].sourceEnd,group.sourceStart).trim())) return null;
    return groups;
  }

  function groupedSentenceRanges(groups) {
    const ranges = groups.map(group => group.range.cloneRange());
    const tokenKey = value => value.toLowerCase().replace(/[\s‐‑‒–—-]/g, "");
    // Chrome can move a sentence's ending FORWARD into the next marker,
    // e.g. Cdh5+ | ECs ... . To enrich ... . Repair that direction first.
    for (let i = 0; i + 1 < groups.length; i++) {
      if (groups[i].failure || groups[i + 1].failure) continue;
      const current = ranges[i].toString(), next = ranges[i + 1].toString();
      if (/[。！？]/u.test(current) || !/[\u3400-\u9fff]/u.test(current) ||
          (next.match(/[。！？]/gu) || []).length !== 2 ||
          englishSentenceSegments(groups[i].saved.text).length !== 1 ||
          englishSentenceSegments(groups[i + 1].saved.text).length !== 1) continue;
      const gap = document.createRange();
      gap.setStart(ranges[i].endContainer, ranges[i].endOffset);
      gap.setEnd(ranges[i + 1].startContainer, ranges[i + 1].startOffset);
      if (selectionWithoutReferences(gap)) continue;
      const ending = next.match(/^[\s\S]*?[。！？][”’」』）)\]]*/u)?.[0];
      if (!ending || !/[\u3400-\u9fff]/u.test(ending)) continue;
      // A preserved scientific token in the continuation must belong to the
      // unfinished English sentence; do not partition by sentence count alone.
      const tokens = ending.match(/[A-Za-z][A-Za-z0-9+‐‑–-]{2,}/g) || [];
      const sourceKeys = (groups[i].saved.text.match(/[A-Za-z][A-Za-z0-9+‐‑–-]*/g)||[]).map(tokenKey);
      if (!tokens.some(token => sourceKeys.includes(tokenKey(token)))) continue;
      const tailRange = sliceTextRange(ranges[i + 1], 0, ending.length);
      if (!tailRange) continue;
      ranges[i].setEnd(tailRange.endContainer, tailRange.endOffset);
      ranges[i + 1].setStart(tailRange.endContainer, tailRange.endOffset);
    }
    for (let i = 0; i + 1 < groups.length; i++) {
      if (groups[i].failure || groups[i + 1].failure) continue;
      const current = ranges[i].toString(), next = ranges[i + 1].toString();
      const source = groups[i].saved.text, nextSource = groups[i + 1].saved.text;
      const tail = current.match(/[。！？][”’」』）)\]]*\s*([^。！？]+)$/u);
      if (!tail || englishSentenceSegments(source).length !== 1 ||
          englishSentenceSegments(nextSource).length !== 1 ||
          !/[.!?][)\]"']*$/.test(source) || !/[\u3400-\u9fff]/.test(current.slice(0, tail.index)) ||
          !/[。！？]/u.test(next) || !/[\u3400-\u9fff]/.test(next)) continue;
      const gap = document.createRange();
      gap.setStart(ranges[i].endContainer, ranges[i].endOffset);
      gap.setEnd(ranges[i + 1].startContainer, ranges[i + 1].startOffset);
      if (selectionWithoutReferences(gap)) continue;
      const prefix = tail[1].trim();
      if (!/[\u3400-\u9fff]/.test(prefix)) {
        const continuation = next.match(/^\s*([-‐‑‒–—]\s*[A-Za-z0-9][A-Za-z0-9‐‑‒–—-]*)/u)?.[1] || "";
        const token = tokenKey(prefix + continuation);
        const sourceTokens=(nextSource.match(/[A-Za-z][A-Za-z0-9‐‑‒–—-]*/g)||[]).map(tokenKey);
        // The translated continuation may no longer be Latin: "Cre-negative"
        // becomes "Cre阴性" with Cre left in the preceding marker. Accept an
        // exact first component of the NEXT sentence's leading compound only.
        const leadingCompound = nextSource.match(/^\s*([A-Za-z][A-Za-z0-9]*)[-‐‑‒–—][A-Za-z0-9]/u);
        const translatedCompound = !continuation && leadingCompound && tokenKey(leadingCompound[1]) === tokenKey(prefix);
        if (!/^[A-Za-z][A-Za-z0-9\s‐‑‒–—-]*$/.test(prefix) || token.length < 3 ||
            (!sourceTokens.includes(token) && !translatedCompound)) continue;
      }
      // The previous sentence can translate into more than one Chinese
      // sentence. Only its unfinished suffix moves; complete sentences stay.
      const offset = tail.index + tail[0].lastIndexOf(tail[1]);
      const suffix = sliceTextRange(ranges[i], offset, current.length);
      if (!suffix) continue;
      ranges[i].setEnd(suffix.startContainer, suffix.startOffset);
      ranges[i + 1].setStart(suffix.startContainer, suffix.startOffset);
    }
    return ranges;
  }

  function sentenceRanges(element, spans) {
    const ranges = [...spans].map(span => {
      const range = document.createRange(); range.selectNodeContents(span); return range;
    });
    for (let i = 0; i + 1 < spans.length; i++) {
      const current = spans[i], next = spans[i + 1];
      if (current.contains(next) || current.querySelector("[data-pb-sentence]")) continue;
      const tail = current.textContent.match(/[。！？][”’」』）)\]]*\s*([^。！？]+)$/u);
      const continuation = next.textContent.match(/^\s*([-‐‑‒–—]\s*[A-Za-z][A-Za-z0-9‐‑‒–—-]*)/u);
      const saved = sentenceRecord(next, element);
      const currentSaved = sentenceRecord(current, element);
      if (!tail || !saved || !currentSaved || !/[.!?][)\]"']*$/.test(currentSaved.text)) continue;
      const normalizeToken = value => value.toLowerCase().replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, "");
      const chineseTail = /[\u3400-\u9fff]/.test(tail[1]);
      if (chineseTail) {
        // Chrome may move an entire opening clause of the next sentence into
        // the preceding span. Require one English sentence on each side and
        // one complete Chinese sentence on each side, with an unfinished
        // tail. Never repair a merged multi-sentence English marker by order.
        if (englishSentenceSegments(currentSaved.text).length !== 1 ||
            englishSentenceSegments(saved.text).length !== 1 ||
            (current.textContent.match(/[。！？]/g) || []).length !== 1 ||
            (next.textContent.match(/[。！？]/g) || []).length !== 1 ||
            tail.index < 1 ||
            !/[\u3400-\u9fff]/.test(next.textContent) ||
            !/[\u3400-\u9fff]/.test(current.textContent.slice(0, tail.index))) continue;
      } else {
        const token = normalizeToken(tail[1] + (continuation?.[1] || ""));
        if (!continuation || !normalizeToken(saved.text).includes(token)) continue;
      }
      const offset = tail.index + tail[0].lastIndexOf(tail[1]);
      const walker = document.createTreeWalker(current, NodeFilter.SHOW_TEXT);
      let consumed = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (consumed + node.length > offset) {
          ranges[i].setEnd(node, offset - consumed);
          ranges[i + 1].setStart(node, offset - consumed);
          break;
        }
        consumed += node.length;
      }
    }
    return ranges;
  }

  function boundaryEvidence(element, spans, index, groups = null, ranges = null) {
    const describe = (span) => {
      if (!span) return null;
      const groupIndex = spans.indexOf(span);
      const record = groups?.[groupIndex].saved || sentenceRecord(span, element);
      const keyRecord = sentenceByKey.get(span.dataset.pbSentence);
      const chinese = normalizedReadableText(ranges?.[groupIndex].toString() || span.textContent);
      return {
        marker: span.dataset.pbSentence,
        chinese: chinese.slice(0, 1500),
        english: record?.text?.slice(0, 1500) || "",
        cacheValid: Boolean(record),
        groupFailure: groups?.[groupIndex].failure || null,
        keyExists: Boolean(keyRecord),
        sameOwner: keyRecord?.paragraph === element,
        ownerConnected: Boolean(keyRecord?.paragraph?.isConnected),
        sameUrl: keyRecord?.url === location.href.split("#")[0],
        copiesInParagraph: element.querySelectorAll(`[data-pb-sentence="${CSS.escape(span.dataset.pbSentence)}"]`).length,
        logicalFragments: groups?.[groupIndex].fragments.length || 1,
        englishSentences: record ? englishSentenceSegments(record.text).length : null,
        chineseStops: (chinese.match(/[。！？]/g) || []).length,
        nestedMarkers: span.querySelectorAll("[data-pb-sentence]").length,
      };
    };
    const current = describe(spans[index]), next = describe(spans[index + 1]);
    const blockers = [];
    if (current?.groupFailure) blockers.push("current-group-"+current.groupFailure.reason);
    if (next?.groupFailure) blockers.push("next-group-"+next.groupFailure.reason);
    if (!current?.cacheValid) blockers.push("current-cache-invalid");
    if (!next) blockers.push("no-next-marker");
    else {
      if (!next.cacheValid) blockers.push("next-cache-invalid");
      if (next.englishSentences !== 1) blockers.push("next-english-not-single-sentence");
      if (groups ? next.chineseStops < 1 : next.chineseStops !== 1)
        blockers.push(groups ? "next-chinese-terminal-missing" : "next-chinese-not-single-sentence");
      if (!/[\u3400-\u9fff]/.test(next.chinese)) blockers.push("next-chinese-missing");
    }
    if (current?.englishSentences !== 1) blockers.push("current-english-not-single-sentence");
    if (groups ? current?.chineseStops < 1 : current?.chineseStops !== 1)
      blockers.push(groups ? "current-chinese-terminal-missing" : "current-chinese-not-single-sentence");
    if (current?.nestedMarkers) blockers.push("nested-markers");
    if (current?.english && !/[.!?][)\]"']*$/.test(current.english)) blockers.push("english-ending-not-terminal");
    return { repairBlockers: blockers, neighboringMarkers: [...spans].slice(Math.max(0,index-1),index+4).map(describe) };
  }

  function isBibliographyReferenceLink(link) {
    if (link.matches('[role="doc-noteref"]')) return true;
    try {
      const target = new URL(link.getAttribute("href"), location.href);
      const page = new URL(location.href);
      if (target.origin !== page.origin || target.pathname !== page.pathname || target.search !== page.search || !target.hash) return false;
      const id = decodeURIComponent(target.hash.slice(1));
      const node = document.getElementById(id);
      return Boolean(node?.closest('[role="doc-biblioentry"], [role="doc-bibliography"]')) ||
        /^(?:ref(?:erence)?[-_:]?(?:CR)?\d|bib[-_:]?\d|cit[-_:]?\d)/i.test(id);
    } catch { return false; }
  }

  function selectionWithoutReferences(input, raw = false) {
    // cloneContents loses an enclosing citation link when a range starts inside
    // its text. Inspect the original ancestors, so fragments and their enclosing
    // group use exactly the same reference filter.
    const common = input.commonAncestorContainer;
    const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
    const nodes = [];
    if (common.nodeType === Node.TEXT_NODE) nodes.push(common);
    else while (walker.nextNode()) nodes.push(walker.currentNode);
    let text = "";
    for (const node of nodes) {
      if (!input.intersectsNode(node)) continue;
      let citation = false;
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!ancestor.matches('sup, a[href], [data-pb-sentence]')) continue;
        const links = ancestor.matches('a[href]') ? [ancestor] : [...ancestor.querySelectorAll('a[href]')];
        if (!/^[\s\d,，、–−-]+$/.test(normalizedReadableText(ancestor.textContent)) ||
            !links.length || !links.every(isBibliographyReferenceLink)) continue;
        if (!ancestor.matches('a[href]')) {
          // One real reference cannot lend its identity to a neighbouring
          // figure link or an unlinked experimental number in the same sup.
          const remainder = ancestor.cloneNode(true);
          for (const link of remainder.querySelectorAll('a[href]')) link.remove();
          if (!/^[\s,，、–−-]*$/.test(normalizedReadableText(remainder.textContent))) continue;
        }
        citation = true; break;
      }
      if (citation) continue;
      const start = node === input.startContainer ? input.startOffset : 0;
      const end = node === input.endContainer ? input.endOffset : node.length;
      text += node.textContent.slice(start, end);
    }
    return raw ? text : coverageKey(text);
  }

  function sliceTextRange(bounds, start, end) {
    const walker=document.createTreeWalker(bounds.commonAncestorContainer,NodeFilter.SHOW_TEXT);
    const nodes=[];
    if(bounds.commonAncestorContainer.nodeType===Node.TEXT_NODE)nodes.push(bounds.commonAncestorContainer);
    else while(walker.nextNode()) if(bounds.intersectsNode(walker.currentNode))nodes.push(walker.currentNode);
    let offset=0, first, last;
    for(const node of nodes) {
      const from=node===bounds.startContainer?bounds.startOffset:0;
      const to=node===bounds.endContainer?bounds.endOffset:node.length;
      const length=to-from;
      if(!first && start<offset+length)first={node,offset:from+Math.max(0,start-offset)};
      if(end>offset && end<=offset+length){last={node,offset:from+end-offset};break;}
      offset+=length;
    }
    if(!first||!last)return null;
    const range=document.createRange();range.setStart(first.node,first.offset);range.setEnd(last.node,last.offset);return range;
  }
  function figureKeys(text) {
    return [...text.matchAll(/(?:fig(?:ure)?s?\.?|图)\s*([sS]?\d+[a-z]?(?:\s*[-–—]\s*(?:[sS]?\d+)?[a-z])?)/gi)]
      .map(m=>m[1].toLowerCase().replace(/\s/g,'').replace(/[–—]/g,'-')).join('|');
  }
  // Split only a cached single English sentence with uniquely corresponding
  // figure references in EVERY Chinese sentence. Ambiguous partitions fail.
  function alignedSentenceParts(bounds, original) {
    const chinese=bounds.toString();
    const segments=[...chinese.matchAll(/[^。！？]+[。！？][”’」』]*/g)];
    if(segments.length<2 || segments.length>6 || chinese.slice(segments.at(-1).index+segments.at(-1)[0].length).trim() ||
       englishSentenceSegments(original).length!==1)return [];
    const keys=segments.map(m=>figureKeys(m[0]));
    if(keys.some(k=>!k)||new Set(keys).size!==keys.length)return [];
    const cuts=[0,...[...original.matchAll(/[,;]\s+(?=(?:which|where|whereas|however|these|this|they|it|although|while|but|and)\b)/gi)].map(m=>m.index+1),original.length];
    if(cuts.length>18)return [];
    const matches=[];
    const search=(i,at,parts)=>{
      if(matches.length>1)return;
      if(i===segments.length){if(at===cuts.length-1)matches.push(parts);return;}
      for(let next=at+1;next<cuts.length;next++) {
        const source=original.slice(cuts[at],cuts[next]).trim();
        if(figureKeys(source)!==keys[i])continue;
        search(i+1,next,[...parts,{original:source,start:segments[i].index,end:segments[i].index+segments[i][0].length}]);
      }
    };
    search(0,0,[]);
    if(matches.length!==1)return [];
    return matches[0].map(part=>({...part,range:sliceTextRange(bounds,part.start,part.end)})).filter(part=>part.range);
  }

  function completeSplitSelection(bounds, selectionRange, original) {
    if (englishSentenceSegments(original).length !== 1) return null;
    const text = bounds.toString();
    const sentences = [...text.matchAll(/[^。！？]+[。！？]+[”’」』）)\]]*/gu)];
    if (sentences.length < 2 || text.slice(sentences.at(-1).index + sentences.at(-1)[0].length).trim()) return null;
    const selected = [];
    for (const [index, sentence] of sentences.entries()) {
      const unit = sliceTextRange(bounds, sentence.index, sentence.index + sentence[0].length);
      if (!unit) return null;
      const intersection = selectionRange.cloneRange();
      if (intersection.compareBoundaryPoints(Range.START_TO_START, unit) < 0)
        intersection.setStart(unit.startContainer, unit.startOffset);
      if (intersection.compareBoundaryPoints(Range.END_TO_END, unit) > 0)
        intersection.setEnd(unit.endContainer, unit.endOffset);
      if (!compactChinese(intersection.toString())) continue;
      // Validate both ends, not only a trailing full stop. Selecting from the
      // middle of a Chinese sentence must not offer a larger source scope.
      if (selectionWithoutReferences(intersection) !== selectionWithoutReferences(unit)) return null;
      selected.push({ index, text: sentence[0], range: unit });
    }
    if (!selected.length || selected.length === sentences.length ||
        selected.some((part, i) => i && part.index !== selected[i - 1].index + 1) ||
        selected.map(part => selectionWithoutReferences(part.range)).join("") !== selectionWithoutReferences(selectionRange)) return null;
    return {
      selected: normalizedReadableText(selectionRange.toString()),
      translation: normalizedReadableText(text),
      before: normalizedReadableText(text.slice(0, sentences[selected[0].index].index)),
      after: normalizedReadableText(text.slice(sentences[selected.at(-1).index].index + sentences[selected.at(-1).index][0].length)),
    };
  }

  function capturedSentenceSelection(element, selectionRange, originalParagraph, diagnostic = {}, scope = null) {
    const pieces = [];
    const expansions = [];
    const finish = source => {
      if (scope && expansions.length) {
        scope.translation = pieces.map(piece => piece.fullTranslation || piece.selected).join(" ");
        scope.expansions = expansions;
      }
      return source;
    };
    let spans = [...element.querySelectorAll("[data-pb-sentence]")];
    diagnostic.sentenceAnchors = spans.length;
    diagnostic.hasEnglishParagraph = Boolean(originalParagraph);
    diagnostic.reason = spans.length ? "no-selected-sentence" : "no-sentence-anchors";
    const groups = sentenceGroups(element, spans, originalParagraph, diagnostic);
    // A fully selected, fully covered source paragraph does not need every
    // internal translated sentence boundary to be repaired. Still validate
    // provenance, source order and all substantive text before using it.
    if (groups && groups.every(group => !group.failure)) {
      const whole = document.createRange(); whole.selectNodeContents(element);
      const covered = groups.map(group => selectionWithoutReferences(group.range)).join("");
      if (covered && covered === selectionWithoutReferences(whole) &&
          covered === selectionWithoutReferences(selectionRange) &&
          groups[0].sourceStart === 0 && groups.at(-1).sourceEnd === originalParagraph.length &&
          groups.every((group,i) => !i || !originalParagraph.slice(groups[i-1].sourceEnd,group.sourceStart).trim())) {
        diagnostic.logicalSentenceAnchors = groups.length;
        diagnostic.reason = "captured";
        diagnostic.mappingEvidence = "complete-validated-paragraph";
        return originalParagraph;
      }
    }
    const logicalRanges = groups ? groupedSentenceRanges(groups) : sentenceRanges(element, spans);
    if (groups) {
      diagnostic.logicalSentenceAnchors = groups.length;
      if (groups.some(group => group.fragments.length > 1))
        diagnostic.mappingEvidence = "validated-sentence-fragment-groups";
      spans = groups.map(group => group.span);
    } else if (new Set(spans.map(span => span.dataset.pbSentence)).size < spans.length) {
      diagnostic.reason = "invalid-sentence-fragment-groups";
      const failedIndex = Math.max(0, spans.findIndex(span => span.dataset.pbSentence === diagnostic.fragmentGroupFailure?.marker));
      diagnostic.boundary = boundaryEvidence(element, spans, failedIndex);
      return null;
    }
    for (let index = 0; index < spans.length; index++) {
      const span = spans[index];
      const range = selectionRange.cloneRange();
      const bounds = logicalRanges[index];
      if (range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
        range.setStart(bounds.startContainer, bounds.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
        range.setEnd(bounds.endContainer, bounds.endOffset);
      const selected = normalizedReadableText(range.toString());
      if (!compactChinese(selected)) continue;
      if (groups?.[index].failure) {
        diagnostic.reason = "invalid-sentence-fragment-groups";
        diagnostic.fragmentGroupFailure = groups[index].failure;
        diagnostic.boundary = boundaryEvidence(element, spans, index, groups, logicalRanges);
        return null;
      }
      const saved = groups?.[index].saved || sentenceRecord(span, element);
      if (!saved || saved.paragraph !== element || saved.url !== location.href.split("#")[0]) {
        diagnostic.boundary = { marker: span.dataset.pbSentence, selected: selected.slice(0,1500), ...boundaryEvidence(element, spans, index) };
        diagnostic.reason = "sentence-cache-missing"; return null;
      }
      if (!originalParagraph.includes(saved.text)) {
        diagnostic.reason = "sentence-source-mismatch"; return null;
      }
      if ((bounds.toString().match(/[。！？]/g) || []).length > 1 && spans[index + 1] &&
          !compactChinese(logicalRanges[index + 1].toString()) && (groups?.[index + 1].saved || sentenceRecord(spans[index + 1], element))) {
        diagnostic.reason = "translation-collapsed-sentences"; return null;
      }
      if (/[。！？]/u.test(bounds.toString()) &&
          !/[。！？][”’」』）)\]\s\d,，、]*$/u.test(bounds.toString())) {
        diagnostic.boundary = boundaryEvidence(element, spans, index, groups, logicalRanges);
        diagnostic.reason = "unresolved-sentence-suffix"; return null;
      }
      if (selectionWithoutReferences(range) !== selectionWithoutReferences(bounds)) {
        const aligned=alignedSentenceParts(bounds,saved.text);
        const selectedParts=aligned.filter(part=>range.intersectsNode(part.range.startContainer) && (()=>{
          const r=range.cloneRange();
          if(r.compareBoundaryPoints(Range.START_TO_START,part.range)<0)r.setStart(part.range.startContainer,part.range.startOffset);
          if(r.compareBoundaryPoints(Range.END_TO_END,part.range)>0)r.setEnd(part.range.endContainer,part.range.endOffset);
          return compactChinese(r.toString()) && selectionWithoutReferences(r)===selectionWithoutReferences(part.range);
        })());
        if(selectedParts.length && selectedParts.map(part=>selectionWithoutReferences(part.range)).join('')===selectionWithoutReferences(range)) {
          pieces.push({selected,original:selectedParts.map(part=>part.original).join(' '),withoutReferences:selectionWithoutReferences(range)});
          diagnostic.mappingEvidence='cached-clause-figure-boundaries';continue;
        }
        const expanded = scope && groups && completeSplitSelection(bounds, range, saved.text);
        if (expanded) {
          pieces.push({selected, original:saved.text, fullTranslation:expanded.translation, withoutReferences:selectionWithoutReferences(range)});
          expansions.push(expanded);
          diagnostic.mappingEvidence = "validated-source-sentence-scope";
          continue;
        }
        const before = bounds.cloneRange();
        before.setEnd(range.startContainer, range.startOffset);
        const after = bounds.cloneRange();
        after.setStart(range.endContainer, range.endOffset);
        diagnostic.boundary = {
          ...boundaryEvidence(element, spans, index, groups, logicalRanges),
          marker: span.dataset.pbSentence,
          selected: selected.slice(0, 1500),
          markerChinese: normalizedReadableText(span.textContent).slice(0, 1500),
          markerVisibleText: normalizedReadableText(span.innerText).slice(0, 1500),
          logicalMarkerChinese: normalizedReadableText(bounds.toString()).slice(0, 1500),
          markerEnglish: saved.text.slice(0, 1500),
          omittedBefore: normalizedReadableText(before.toString()).slice(-500),
          omittedAfter: normalizedReadableText(after.toString()).slice(0, 500),
          nestedMarkers: span.querySelectorAll("[data-pb-sentence]").length,
          childTags: [...span.children].map(child => ({
            tag: child.tagName,
            hidden: child.hidden || getComputedStyle(child).display === "none",
          })).slice(0, 20),
        };
        diagnostic.reason = "partial-sentence-boundary"; return null;
      }
      pieces.push({ selected, original: saved.text, withoutReferences: selectionWithoutReferences(range) });
    }
    diagnostic.selectedSentences = pieces.length;
    if (!pieces.length) return null;
    if (pieces.map(p => p.withoutReferences).join("") !== selectionWithoutReferences(selectionRange)) {
      const fragment = selectionRange.cloneContents();
      for (const node of fragment.querySelectorAll("[data-pb-sentence]")) node.remove();
      diagnostic.boundary = {
        selected: normalizedReadableText(selectionRange.toString()).slice(0,4000),
        coveredText: pieces.map(piece => piece.selected).join(" ").slice(0,4000),
        unmarkedText: normalizedReadableText(fragment.textContent).slice(0,2000),
        originalParagraph: originalParagraph.slice(0,6000),
        coveredEnglish: pieces.map(piece => piece.original).join(" ").slice(0,6000),
        unmarkedElements: [...fragment.querySelectorAll("a[href],sup,sub")].slice(0,30).map(node => ({tag:node.tagName,text:node.textContent,href:node.getAttribute("href")})),
      };
      diagnostic.reason = "uncovered-selection-text"; return null;
    }
    const source = pieces.map(p => p.original).join(" ");
    // Repeated sentences inside a paragraph are individually ambiguous, but
    // their entire validated, fully covered source sequence can still be exact.
    if (source === originalParagraph) {
      const whole = document.createRange(); whole.selectNodeContents(element);
      if (selectionWithoutReferences(selectionRange) === selectionWithoutReferences(whole)) {
        diagnostic.reason = "captured";
        diagnostic.mappingEvidence = "complete-captured-sentence-sequence";
        return finish(source);
      }
    }
    if (!originalParagraph.includes(source) || coverageKey(selectionRange.toString()) === coverageKey(element.textContent)) {
      const referenceNumbers = new Set([...element.querySelectorAll('a[href]')]
        .filter(link => isBibliographyReferenceLink(link) && /^[\s\d,，、–−-]+$/.test(link.textContent))
        .flatMap(link => link.textContent.match(/\d+/g) || []));
      const referenceGap = gap => !/[^\s\d.,，、;:()[\]–−-]/u.test(gap) &&
        (gap.match(/\d+/g) || []).every(number => referenceNumbers.has(number));
      let start = -1, end = 0, valid = true;
      for (const piece of pieces) {
        const at = originalParagraph.indexOf(piece.original, end);
        if (at < 0 || originalParagraph.indexOf(piece.original, at + 1) >= 0 ||
            (start >= 0 && !referenceGap(originalParagraph.slice(end, at)))) {valid=false;break;}
        if (start < 0) start = at;
        end = at + piece.original.length;
      }
      if (valid && start >= 0) {
        if (coverageKey(selectionRange.toString()) === coverageKey(element.textContent)) {
          if (!referenceGap(originalParagraph.slice(0,start)) || !referenceGap(originalParagraph.slice(end))) valid=false;
          else {start=0;end=originalParagraph.length;}
        }
        if (valid) {
          diagnostic.reason = "captured"; diagnostic.mappingEvidence = "verified-reference-gaps";
          return finish(originalParagraph.slice(start,end));
        }
      }
      diagnostic.reason = "noncontiguous-source"; return null;
    }
    diagnostic.reason = originalParagraph.includes(source) ? "captured" : "noncontiguous-source";
    return originalParagraph.includes(source) ? finish(source) : null;
  }

  function buildAnchor(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      return null;
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) return null;
    let exact = normalizedReadableText(selection.toString());
    if (exact.length < 2 || !/[\p{L}\p{N}]/u.test(exact)) return null;

    const commonElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const hasControl = commonElement.closest(interactiveTextSelector) ||
      [...range.cloneContents().querySelectorAll(interactiveTextSelector)].some(node => node.textContent.trim());
    const selectionIssue = hasControl ? "选区包含按钮或可编辑内容，请只选择论文正文。" : "";

    const container = nearestTextContainer(range.commonAncestorContainer);
    const paragraph = normalizedReadableText(container.textContent);
    const pageContainers = Array.from(
      document.querySelectorAll(textContainerSelector),
    ).filter((element) => !root.contains(element) && isTextContainer(element));
    const parts = [];
    const excludedReferences = [];
    for (const element of pageContainers) {
      if (!range.intersectsNode(element)) continue;
      const clipped = range.cloneRange();
      const block = document.createRange();
      block.selectNodeContents(element);
      if (clipped.compareBoundaryPoints(Range.START_TO_START, block) < 0)
        clipped.setStart(block.startContainer, block.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, block) > 0)
        clipped.setEnd(block.endContainer, block.endOffset);
      const selected = normalizedReadableText(clipped.toString());
      if (!selected) continue;
      // A standalone bibliography-reference block can fall inside a drag
      // selection. Exclude it only when DOM-aware reference filtering removes
      // ALL its text. Unknown short prose, numbers and figure links remain.
      if (!normalizedReadableText(selectionWithoutReferences(clipped, true))) {
        excludedReferences.push(clipped.cloneRange());
        continue;
      }
      const id = element.id || "";
      const uniqueId =
        id &&
        document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1;
      const sentenceDiagnostic = {};
      const capturedSentenceSource = capturedSentenceSelection(element, clipped, capturedOriginal(element), sentenceDiagnostic);
      sentenceDiagnostic.elementTag = element.tagName.toLowerCase();
      sentenceDiagnostic.elementRole = element.getAttribute("role");
      let sourceSentenceProposal = null;
      if (!capturedSentenceSource && sentenceDiagnostic.reason === "partial-sentence-boundary") {
        const scope = {};
        const source = capturedSentenceSelection(element, clipped, capturedOriginal(element), {}, scope);
        if (source && scope.expansions?.length) sourceSentenceProposal = { source, ...scope };
      }
      parts.push({
        exact: selected,
        paragraph: normalizedReadableText(element.textContent),
        originalParagraph:
          capturedOriginal(element) ||
          (uniqueId
            ? originalTextById.get(`${location.href.split("#")[0]}#${id}`)
            : "") ||
          "",
        containerId: uniqueId ? id : "",
        capturedSentenceSource,
        sourceSentenceProposal,
        sentenceDiagnostic,
      });
    }
    if (excludedReferences.length) {
      // Project the SAME DOM exclusions onto the whole selection, preserving
      // any unrecognized text between blocks for the existing coverage check.
      const remaining = range.cloneRange(), text = [];
      for (const excluded of excludedReferences) {
        const before = remaining.cloneRange();
        before.setEnd(excluded.startContainer, excluded.startOffset);
        text.push(before.toString());
        remaining.setStart(excluded.endContainer, excluded.endOffset);
      }
      text.push(remaining.toString());
      exact = normalizedReadableText(text.join(" "));
      if (!exact) return null;
    }
    const index = paragraph.indexOf(exact);
    const contextSize = 96;
    const prefix =
      index >= 0
        ? paragraph.slice(Math.max(0, index - contextSize), index)
        : "";
    const suffix =
      index >= 0
        ? paragraph.slice(
            index + exact.length,
            index + exact.length + contextSize,
          )
        : "";

    const anchor = {
      exact,
      prefix,
      suffix,
      paragraph,
      originalParagraph: capturedOriginal(container),
      containerIndex: pageContainers.indexOf(container),
      containerId: parts.length === 1 ? parts[0].containerId : "",
      parts,
      selectionIssue,
      excludedReferenceBlocks: excludedReferences.length,
      sectionHeading: findHeading(container),
      selectedLanguage: /[\u3400-\u9fff]/.test(exact) ? "zh" : "en",
    };
    anchorRanges.set(anchor, range.cloneRange());
    return anchor;
  }

  function compactChinese(value) {
    return normalizedReadableText(value)
      .toLocaleLowerCase("zh-CN")
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  function coverageKey(value) {
    // Coverage is stricter than fuzzy text comparison: dropping a minus sign,
    // decimal point, percentage or operator changes the selected evidence.
    // Ignore ordinary prose punctuation, but retain every ASCII point: a point
    // at a fragment edge may be inside a decimal in the next DOM fragment.
    // Citation text is removed by the DOM-aware caller.
    const text = normalizedReadableText(value).toLocaleLowerCase("zh-CN").replace(/\s+/gu, "");
    return text.replace(/[。！？.!?,，、;；:：“”‘’"'「」『』（）()[\]{}【】]/gu, (mark, offset) => {
      const before = text[offset - 1] || "", after = text[offset + mark.length] || "";
      const beforeNumber = /\p{N}/u.test(before), afterNumber = /\p{N}/u.test(after);
      if (mark === "." || (beforeNumber && afterNumber) ||
          (/[‘’"']/u.test(mark) && (beforeNumber || afterNumber))) return mark;
      return "";
    });
  }

  function bigramSimilarity(left, right) {
    if (!left || !right) return 0;
    if (left.includes(right) || right.includes(left)) {
      const coverage =
        Math.min(left.length, right.length) /
        Math.max(left.length, right.length);
      return 0.65 + coverage * 0.35;
    }
    const grams = (value) => {
      const result = [];
      for (let index = 0; index < value.length - 1; index += 1)
        result.push(value.slice(index, index + 2));
      return result;
    };
    const leftGrams = grams(left);
    const rightGrams = grams(right);
    const remaining = new Map();
    for (const gram of leftGrams)
      remaining.set(gram, (remaining.get(gram) || 0) + 1);
    let overlap = 0;
    for (const gram of rightGrams) {
      const count = remaining.get(gram) || 0;
      if (count > 0) {
        overlap += 1;
        remaining.set(gram, count - 1);
      }
    }
    return (2 * overlap) / Math.max(1, leftGrams.length + rightGrams.length);
  }

  function sentenceCandidates(paragraph) {
    if ("Segmenter" in Intl) {
      return Array.from(
        englishSentenceSegments(paragraph),
        (part) => part.segment.trim(),
      ).filter((part) => part.length >= 8);
    }
    return (
      paragraph
        .match(/[^.!?]+(?:[.!?]+|$)/g)
        ?.map((part) => part.trim())
        .filter(Boolean) || [paragraph]
    );
  }

  function sentenceSpans(paragraph, locale = "en") {
    const text = normalizedReadableText(paragraph);
    if (!text) return [];
    if ("Segmenter" in Intl) {
      return Array.from(
        locale === "en" ? englishSentenceSegments(text) : new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text),
        (part) => ({
          text: part.segment.trim(),
          start: part.index,
          end: part.index + part.segment.length,
        }),
      ).filter((part) => part.text.length >= 2);
    }
    const spans = [];
    const pattern = /[^.!?。！？]+(?:[.!?。！？]+|$)/g;
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim();
      if (value.length >= 2) {
        spans.push({
          text: value,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
    return spans;
  }

  function mappedEnglishAnchor(
    anchor,
    originalParagraph,
    source,
    mappingScore,
    mappingMethod,
  ) {
    const index = originalParagraph.indexOf(source);
    return {
      ...anchor,
      exact: source,
      prefix:
        index >= 0
          ? originalParagraph.slice(Math.max(0, index - 96), index)
          : "",
      suffix:
        index >= 0
          ? originalParagraph.slice(
              index + source.length,
              index + source.length + 96,
            )
          : "",
      paragraph: originalParagraph,
      originalParagraph,
      selectedLanguage: "en",
      translatedSelection: anchor.exact,
      translatedParagraph: anchor.translatedParagraph || anchor.paragraph,
      selectionMode: "translated",
      mappingScore,
      mappingMethod,
    };
  }

  function fastPositionMapping(anchor, originalParagraph) {
    const translatedParagraph = normalizedReadableText(anchor.paragraph);
    const selectedText = normalizedReadableText(anchor.exact);
    const compactParagraph = coverageKey(translatedParagraph);
    const compactSelected = coverageKey(selectedText);
    if (!compactParagraph || !compactSelected) return null;

    // Position and partial coverage alone cannot prove bilingual equivalence.
    if (compactParagraph === compactSelected) {
      return mappedEnglishAnchor(
        anchor,
        originalParagraph,
        originalParagraph,
        1,
        "captured-whole-paragraph",
      );
    }
    return null;
  }
  function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function fetchSourceParagraphs() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(location.href, {
        credentials: "include",
        cache: "no-cache",
        signal: controller.signal,
      });
      if (response.status === 403 || response.status === 429) {
        throw new Error(
          `论文网站暂时拒绝读取英文原文（HTTP ${response.status}）。这不等于账号被封禁。请稍后直接打开论文网页；如出现验证，请在网页中完成。`,
        );
      }
      if (!response.ok) {
        throw new Error(`无法重新读取英文原网页（HTTP ${response.status}）。`);
      }
      const html = await response.text();
      const sourceDocument = new DOMParser().parseFromString(html, "text/html");
      if (
        /checking your browser|just a moment|access denied|forbidden|captcha|验证/i.test(
          sourceDocument.title,
        ) ||
        (/checking your browser before accessing/i.test(
          sourceDocument.body?.textContent || "",
        ) &&
          !sourceDocument.querySelector("article"))
      ) {
        throw new Error(
          "论文网站返回了浏览器验证页，尚未取得英文正文。请先直接打开论文网页完成验证，再刷新论文页。",
        );
      }
      const paragraphs = Array.from(
        sourceDocument.querySelectorAll(textContainerSelector),
      )
        .filter(isTextContainer)
        .map((element) => ({
          id: element.id || "",
          text: normalizedReadableText(element.textContent),
        }));
      if (
        !paragraphs.some((paragraph) => looksPrimarilyEnglish(paragraph.text))
      ) {
        throw new Error(
          "网站未返回可用的英文正文，请先确认论文网页可以正常阅读。",
        );
      }
      return paragraphs;
    } catch (error) {
      const message = controller.signal.aborted
        ? "读取英文原网页超过 10 秒，已停止请求。请先确认论文网页可以正常打开。"
        : error instanceof Error
          ? error.message
          : String(error);
      state.sourceFetchRetryAt = Date.now() + 60000;
      state.sourceFetchError = `${message} 扩展已暂停重新读取 1 分钟；已保存的英文段落仍可使用。`;
      throw new Error(state.sourceFetchError);
    } finally {
      clearTimeout(timer);
    }
  }

  async function recoverOriginalParagraph(anchor) {
    if (looksPrimarilyEnglish(anchor.originalParagraph)) {
      return anchor.originalParagraph;
    }
    if (!anchor.containerId) {
      throw new Error(
        "未保存这段对应的英文，且网页没有稳定段落标识。请先恢复英文并刷新网页，再启用整页翻译；无需重新配对 Zotero。",
      );
    }
    const url = location.href.split("#")[0];
    if (state.sourceParagraphsUrl !== url) {
      state.sourceParagraphsUrl = url;
      state.sourceParagraphsPromise = null;
      state.sourceFetchRetryAt = 0;
      state.sourceFetchError = "";
    }
    if (!state.sourceParagraphsPromise) {
      if (Date.now() < state.sourceFetchRetryAt) {
        throw new Error(state.sourceFetchError);
      }
      state.sourceParagraphsPromise = fetchSourceParagraphs().catch((error) => {
        state.sourceParagraphsPromise = null;
        throw error;
      });
    }
    const sourceParagraphs = await state.sourceParagraphsPromise;
    const matches = sourceParagraphs.filter(
      (paragraph) => paragraph.id === anchor.containerId,
    );
    if (matches.length !== 1 || !looksPrimarilyEnglish(matches[0].text)) {
      throw new Error(
        "原网页段落标识缺失或重复，未猜测英文位置。请恢复英文并刷新网页后重新翻译。",
      );
    }
    return matches[0].text;
  }

  function translatedMappingCandidates(paragraph) {
    const sentences = sentenceCandidates(paragraph).slice(0, 30);
    const clauses=sentences.flatMap(sentence=>{
      const cuts=[0,...[...sentence.matchAll(/[,;]\s+(?=(?:which|where|whereas|however|these|this|they|it|although|while|but|and)\b)/gi)].map(m=>m.index+1),sentence.length];
      return cuts.slice(0,-1).flatMap((start,i)=>cuts.slice(i+1).map(end=>sentence.slice(start,end).trim()));
    });
    const candidates = [paragraph, ...sentences, ...clauses];
    for (let windowSize = 2; windowSize <= 5; windowSize += 1) {
      for (let start = 0; start + windowSize <= sentences.length; start += 1) {
        candidates.push(sentences.slice(start, start + windowSize).join(" "));
      }
    }
    return Array.from(new Set(candidates))
      .filter((candidate) => candidate.length >= 8 && candidate.length <= 5000)
      .slice(0, 80);
  }

  function shortlistMappingCandidates(anchor, originalParagraph) {
    const candidates = translatedMappingCandidates(originalParagraph);
    const translatedParagraph = normalizedReadableText(anchor.paragraph);
    const selectedText = normalizedReadableText(anchor.exact);
    const selectionStart = Math.max(
      0,
      translatedParagraph.indexOf(selectedText),
    );
    const relativeCenter = translatedParagraph.length
      ? (selectionStart + selectedText.length / 2) / translatedParagraph.length
      : 0.5;
    const targetLength = Math.max(
      24,
      Math.round(
        originalParagraph.length *
          Math.min(
            1,
            selectedText.length / Math.max(1, translatedParagraph.length),
          ),
      ),
    );
    return candidates
      .map((candidate) => {
        const index = Math.max(0, originalParagraph.indexOf(candidate));
        const center =
          (index + candidate.length / 2) / originalParagraph.length;
        const positionPenalty = Math.abs(center - relativeCenter);
        const lengthPenalty =
          Math.abs(candidate.length - targetLength) / Math.max(targetLength, 1);
        return { candidate, rank: positionPenalty * 2 + lengthPenalty * 0.35 };
      })
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 6)
      .map(({ candidate }) => candidate);
  }

  async function mapTranslatedSelection(anchor) {
    if (anchor.selectionIssue) throw new Error(anchor.selectionIssue);
    if (anchor.parts?.length) {
      if (anchor.parts.length > 8)
        throw new Error("选区超过 8 个文字块，请分段选择。");
      if (
        coverageKey(anchor.parts.map((part) => part.exact).join(" ")) !==
        coverageKey(anchor.exact)
      )
        throw new Error("选区包含未识别的文字块，请分别选择正文段落。");
      const mapped = [];
      for (const part of anchor.parts) {
        try {
          mapped.push(await mapTranslatedSelection({ ...part, selectedLanguage: "zh", useSourceSentenceScope: anchor.useSourceSentenceScope }));
        } catch (error) {
          if (anchor.parts.length > 1 && part.sentenceDiagnostic?.reason === "no-sentence-anchors")
            throw new Error(`选区中的“${part.exact.slice(0, 24)}${part.exact.length > 24 ? "…" : ""}”没有英文原文锚点。请避开这个额外文字块后重选正文；未跳过任何未知正文。`);
          throw error;
        }
      }
      return {
        ...anchor,
        exact: mapped.map((part) => part.exact).join(" "),
        originalParagraph: mapped
          .map((part) => part.originalParagraph)
          .join(" "),
        paragraph: mapped.map((part) => part.originalParagraph).join(" "),
        prefix: mapped[0].prefix,
        suffix: mapped[mapped.length - 1].suffix,
        translatedSelection: anchor.exact,
        annotationTranslation: mapped.map(part => part.annotationTranslation || part.translatedSelection).join(" "),
        sourceSentenceExpansions: mapped.flatMap(part => part.sourceSentenceExpansions || []),
        translatedParagraph: anchor.paragraph,
        selectedLanguage: "en",
        selectionMode: "translated",
        diagnosticParts: anchor.parts,
        parts: undefined,
        mappingMethod: "verified-blocks",
        mappingScore: Math.min(...mapped.map((part) => part.mappingScore)),
      };
    }
    if (!anchor.capturedSentenceSource &&
        !(anchor.useSourceSentenceScope && anchor.sourceSentenceProposal) &&
        anchor.sentenceDiagnostic?.reason === "partial-sentence-boundary" &&
        !/[。！？][”’」』）)\]\s\d,，、]*$/u.test(normalizedReadableText(anchor.exact)))
      throw new Error("请选中完整句子；当前选区未到句末，不会自动扩大标注范围。");
    const originalParagraph = await recoverOriginalParagraph(anchor);
    if (anchor.useSourceSentenceScope && anchor.sourceSentenceProposal) {
      const proposal = anchor.sourceSentenceProposal;
      if (!proposal.expansions?.length || !originalParagraph.includes(proposal.source))
        throw new Error("完整原句范围已失效，请重新选择文字。");
      return {
        ...mappedEnglishAnchor(anchor, originalParagraph, proposal.source, 1, "confirmed-source-sentence-scope"),
        annotationTranslation: proposal.translation,
        sourceSentenceExpansions: proposal.expansions,
      };
    }
    if (anchor.capturedSentenceSource && originalParagraph.includes(anchor.capturedSentenceSource))
      return mappedEnglishAnchor(anchor, originalParagraph, anchor.capturedSentenceSource, 1, "captured-sentence-range");
    // A stale/copied sentence marker must not be bypassed by treating the
    // changed paragraph as a whole-paragraph translation of its old snapshot.
    const hasUnverifiedSentenceMarkers =
      anchor.sentenceDiagnostic?.sentenceAnchors > 0 &&
      anchor.sentenceDiagnostic.reason !== "captured";
    if (hasUnverifiedSentenceMarkers &&
        anchor.sentenceDiagnostic.reason !== "partial-sentence-boundary") {
      throw new Error("当前句子的原文标记或文字覆盖未通过校验，无法可靠定位。请恢复英文、刷新后重新翻译。");
    }
    const fastMatch = hasUnverifiedSentenceMarkers
      ? null
      : fastPositionMapping(anchor, originalParagraph);
    if (fastMatch) return fastMatch;
    const candidates = shortlistMappingCandidates(anchor, originalParagraph);
    const translator = await getTranslator();
    // Character similarity cannot validate a quote: changing one
    // number, gene name or negation can still score above 0.95. Accept only the
    // same complete translation, preserving meaningful punctuation and symbols.
    const translationKey = value => normalizedReadableText(value).normalize("NFKC")
      .toLocaleLowerCase("zh-CN").replace(/\s+/gu, "").replace(/[。.!?！？]+$/u, "");
    const selected = translationKey(anchor.exact);
    const ranked = [];
    const deadline = Date.now() + 12000;
    for (const candidate of candidates) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error("英文回查尚未完成候选核验，请缩短选区后重试。");
      const translated = await withTimeout(
        translator.translate(candidate),
        Math.min(4000, remaining),
        "英文反查超时，请重新选择完整句子或段落。",
      );
      const unique = originalParagraph.indexOf(candidate) >= 0 &&
        originalParagraph.indexOf(candidate, originalParagraph.indexOf(candidate) + 1) < 0;
      const score = unique && selected === translationKey(translated) ? 1 : 0;
      ranked.push({ source: candidate, translated, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (
      !best ||
      best.score < (anchor.sentenceDiagnostic?.reason === "partial-sentence-boundary" ? 0.95 : 0.78) ||
      (ranked[1] && best.score - ranked[1].score < 0.1)
    ) {
      throw new Error(
        "当前选区尚未可靠地通过英文对应核验；可保留诊断后重试，或选择相邻文字扩大上下文。",
      );
    }
    if (!looksPrimarilyEnglish(best.source)) {
      throw new Error(
        "反查结果仍含中文，已阻止发送到英文 PDF。请重新选择该段。",
      );
    }
    return mappedEnglishAnchor(
      anchor,
      originalParagraph,
      best.source,
      best.score,
      "local-translation-shortlist",
    );
  }

  function updateDocumentLine() {
    const doi = extractDoi();
    documentLine.textContent = doi
      ? `${document.title} · ${doi}`
      : document.title;
  }

  function documentLocator() {
    return {
      document: {
        doi: extractDoi(),
        url: location.href,
        canonicalUrl:
          document.querySelector('link[rel="canonical"]')?.href ||
          location.href,
        title: document.title,
      },
    };
  }

  function selectionPayload() {
    return {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...documentLocator(),
      selector: {
        type: "TextQuoteSelector",
        exact: state.anchor?.exact || "",
        prefix: state.anchor?.prefix || "",
        suffix: state.anchor?.suffix || "",
        heading: state.anchor?.sectionHeading || "",
      },
      context: {
        paragraph: state.anchor?.paragraph || "",
        sectionHeading: state.anchor?.sectionHeading || "",
      },
    };
  }

  function renderAnchor() {
    updateDocumentLine();
    const hasAnchor = Boolean(state.anchor);
    empty.hidden = hasAnchor;
    sourceCard.hidden = !hasAnchor;
    translationCard.hidden = !hasAnchor;
    noteWrap.hidden = !hasAnchor;
    colorWrap.hidden = !hasAnchor;
    actions.hidden = !hasAnchor;
    syncButton.disabled =
      state.syncing || !hasAnchor || !isPdfAnchorReady(state.anchor);
    openSelectionButton.disabled =
      state.locating || !hasAnchor || !isPdfAnchorReady(state.anchor);
    openSelectionButton.title = openSelectionButton.disabled
      ? "选择一段文字后可定位"
      : "在 Zotero PDF 中定位当前段落";
    const isChineseSelection = state.anchor?.selectedLanguage === "zh";
    root.querySelector(".pb-scope-proposal").hidden = true;
    const expansions = state.anchor?.sourceSentenceExpansions || [];
    root.querySelector(".pb-scope-notice").hidden = !expansions.length;
    root.querySelector(".pb-scope-selected").textContent = expansions.length
      ? `最初所选：${state.anchor.translatedSelection}` : "";
    root.querySelector(".pb-scope-added").textContent = expansions.length
      ? `补入的同句译文：${expansions.flatMap(part => [part.before, part.after]).filter(Boolean).join(" ")}` : "";
    sourceLabel.textContent = "PDF 定位原文";
    sourceState.textContent = isChineseSelection ? "待匹配" : expansions.length ? "完整原句范围" : "英文锚点";
    translationState.textContent = isChineseSelection ? "网页译文" : expansions.length ? "完整原句译文" : "阅读译文";
    sourceNode.textContent = isChineseSelection
      ? "正在匹配对应的英文原文……"
      : state.anchor?.exact || "";
    translationNode.textContent = isChineseSelection
      ? state.anchor?.exact || ""
      : state.translation || "等待翻译……";
    updateTextAction();
    refreshExpansionControls(true);
    if (hasAnchor && state.anchor.selectedLanguage !== "en") {
      setStatus(
        "当前选择看起来不是英文原文。请关闭浏览器整页翻译后选择原文，定位会更可靠。",
        "warn",
      );
    }
  }

  async function getTranslator() {
    if (state.translator) return state.translator;
    if (!("Translator" in globalThis)) {
      throw new Error(
        "当前 Chrome 不支持本地 Translator API；需要 Chrome 138 或更高版本。",
      );
    }

    const availability = await globalThis.Translator.availability({
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
    if (availability === "unavailable") {
      throw new Error("当前设备不支持英译中语言包。");
    }

    state.translator = await globalThis.Translator.create({
      sourceLanguage: "en",
      targetLanguage: "zh",
    });
    return state.translator;
  }

  async function translateSelection() {
    if (!state.anchor || state.translating) return;
    if (state.anchor.selectedLanguage !== "en") {
      setStatus(
        "为了能回写 PDF，请选择英文原文，再由扩展生成中文译文。",
        "warn",
      );
      return;
    }

    const requestAnchor = state.anchor;
    const requestId = ++state.translationRequestId;
    const isCurrent = () => requestId === state.translationRequestId && state.anchor === requestAnchor;
    state.translating = true;
    updateTextAction();
    translationNode.textContent = "正在调用 Chrome 本地翻译……";
    refreshExpansionControls();
    setStatus("正在翻译；首次使用可能需要下载语言包");
    try {
      const translator = await getTranslator();
      if (!isCurrent()) return;
      const translation = await translator.translate(
        requestAnchor.exact.slice(0, 5000),
      );
      if (!isCurrent()) return;
      state.translation = translation;
      translationNode.textContent = state.translation;
      refreshExpansionControls(true);
      setStatus("译文已生成，原文锚点保持不变", "good");
    } catch (error) {
      if (!isCurrent()) return;
      state.translation = "";
      translationNode.textContent = "未生成译文";
      refreshExpansionControls();
      setStatus(error instanceof Error ? error.message : String(error), "warn");
    } finally {
      if (isCurrent()) {
        state.translating = false;
        updateTextAction();
      }
    }
  }

  async function mapChineseSelection() {
    if (
      !state.anchor ||
      state.anchor.selectedLanguage !== "zh" ||
      state.mappingInProgress
    )
      return;
    const requestId = ++state.mappingRequestId;
    const translatedSelection = state.anchor.exact;
    state.mappingInProgress = true;
    updateTextAction();
    setStatus("正在匹配中文选区对应的英文原文……");
    try {
      // A verified source-sentence alternative needs no second translator and
      // must never be applied implicitly. Offer its exact scope for inspection.
      if (!state.anchor.useSourceSentenceScope && showSourceSentenceProposal(state.anchor)) {
        sourceState.textContent = "待选择范围";
        sourceNode.textContent = "该中文选句属于一个更完整的英文原句，请检查上方范围。";
        setStatus("已找到完整英文原句；采用上方范围后即可定位。", "neutral", false);
        return;
      }
      const mappedAnchor = await withTimeout(
        mapTranslatedSelection(state.anchor),
        15000,
        "英文原文匹配超过 15 秒，已停止。请重新选择完整句子或段落。",
      );
      if (requestId !== state.mappingRequestId) return;
      state.anchor = mappedAnchor;
      state.translation = mappedAnchor.annotationTranslation || translatedSelection;
      renderAnchor();
      setStatus("已找回英文原文；同步时还需在 Zotero PDF 中定位", "good");
    } catch (error) {
      if (requestId !== state.mappingRequestId) return;
      sourceState.textContent = "未匹配";
      sourceNode.textContent = "尚未匹配到英文原文";
      setStatus(error instanceof Error ? error.message : String(error), "warn");
    } finally {
      if (requestId === state.mappingRequestId) {
        state.mappingInProgress = false;
        updateTextAction();
      }
    }
  }

  function sourceSentenceScope(anchor) {
    const parts = anchor?.parts?.length ? anchor.parts : [anchor];
    if (!parts.every(part => part && (part.capturedSentenceSource || part.sourceSentenceProposal)) ||
        !parts.some(part => part.sourceSentenceProposal) ||
        coverageKey(parts.map(part => part.exact).join(" ")) !== coverageKey(anchor.exact)) return null;
    return {
      source: parts.map(part => part.sourceSentenceProposal?.source || part.capturedSentenceSource).join(" "),
      translation: parts.map(part => part.sourceSentenceProposal?.translation || part.exact).join(" "),
    };
  }

  function showSourceSentenceProposal(anchor) {
    const proposal = sourceSentenceScope(anchor);
    if (!proposal) return false;
    root.querySelector(".pb-scope-original").textContent = proposal.source;
    root.querySelector(".pb-scope-translation").textContent = proposal.translation;
    root.querySelector(".pb-scope-proposal").hidden = false;
    return true;
  }

  function rebuildSelectedAnchor() {
    const range = state.selectionRange;
    if (!range || range.collapsed || !range.startContainer.isConnected || !range.endContainer.isConnected) return null;
    return buildAnchor({ rangeCount: 1, isCollapsed: false, getRangeAt: () => range, toString: () => range.toString() });
  }

  root.querySelector(".pb-use-source-sentence").addEventListener("click", () => {
    if (state.mappingInProgress || state.anchor?.selectedLanguage !== "zh" || !sourceSentenceScope(state.anchor)) return;
    // Rebuild from the still-selected live DOM before adopting a previously
    // shown alternative. A later translation rewrite must invalidate it.
    const current = rebuildSelectedAnchor();
    const previousScope = sourceSentenceScope(state.anchor);
    const currentScope = current && sourceSentenceScope(current);
    if (!currentScope || coverageKey(current.exact) !== coverageKey(state.anchor.exact) ||
        currentScope.source !== previousScope.source || currentScope.translation !== previousScope.translation) {
      root.querySelector(".pb-scope-proposal").hidden = true;
      setStatus("网页选区或译文已变化，请重新选择文字后采用完整原句范围。", "warn");
      return;
    }
    // Selection.toString inserts rendered block separators; Range.toString
    // does not. Preserve the original display text after coverage validation.
    current.exact = state.anchor.exact;
    state.anchor = { ...current, useSourceSentenceScope: true };
    renderAnchor();
    void mapChineseSelection();
  });

  function runTextAction() {
    if (state.anchor?.selectionIssue) {
      setStatus(state.anchor.selectionIssue, "warn");
      return;
    }
    if (state.anchor?.selectedLanguage === "zh") {
      void mapChineseSelection();
      return;
    }
    if (state.anchor?.selectionMode === "translated") {
      if (state.anchor.sourceSentenceExpansions?.length) {
        const current = rebuildSelectedAnchor();
        const scope = current && sourceSentenceScope(current);
        const stillSame = scope && scope.source === state.anchor.exact &&
          scope.translation === state.anchor.annotationTranslation;
        if (!current) {
          state.anchor = {
            exact: state.anchor.translatedSelection,
            paragraph: state.anchor.translatedParagraph,
            selectedLanguage: "zh",
          };
          state.translation = "";
          renderAnchor();
          setStatus("原选区已被网页替换，请重新选择文字后匹配。", "warn");
          return;
        }
        activateAnchor(current);
        if (stillSame) state.anchor.useSourceSentenceScope = true;
        renderAnchor();
        if (state.anchor.selectedLanguage === "zh") void mapChineseSelection();
        else void translateSelection();
        return;
      }
      const translatedAnchor = {
        ...state.anchor,
        exact: state.anchor.translatedSelection,
        paragraph: state.anchor.translatedParagraph,
        parts: state.anchor.diagnosticParts,
        selectedLanguage: "zh",
      };
      state.anchor = translatedAnchor;
      state.translation = "";
      renderAnchor();
      void mapChineseSelection();
      return;
    }
    void translateSelection();
  }

  async function syncAnnotation() {
    if (state.syncing) return;
    if (!state.anchor || !isPdfAnchorReady(state.anchor)) {
      setStatus(
        "尚未取得对应英文原文，当前中文选择不能直接发送到 PDF。",
        "warn",
      );
      return;
    }
    state.syncing = true;
    const requestAnchor = state.anchor;
    const started = Date.now();
    syncButton.disabled = true;
    const slowTimer = setTimeout(() => {
      if (state.anchor === requestAnchor)
        setStatus(
          "仍在等待 Zotero 读取 PDF；请勿重复同步。超过时限会显示原因。",
          "warn",
          false,
        );
    }, 8000);
    setStatus("正在读取并定位 PDF 全文；首次同步可能需要几秒……");
    const annotation = {
      ...selectionPayload(),
      translation: state.translation,
      comment: noteNode.value.trim(),
      color: state.color,
      commit: true,
    };

    try {
      const response = await chrome.runtime.sendMessage({
        type: "paperbridge:sync",
        annotation,
      });
      if (state.anchor !== requestAnchor) return;
      if (response?.ok) {
        if (response.nativePdfHighlightCreated) {
          const page = response.match?.pageLabel
            ? `第 ${response.match.pageLabel} 页`
            : "对应位置";
          setStatus(
            `已在 Zotero PDF ${page}创建原生高亮；译文和笔记已附在批注中（${((Date.now() - started) / 1000).toFixed(1)} 秒）`,
            "good",
          );
          state.openTarget = {
            attachmentID: response.attachmentID,
            annotationKey: response.annotationKey,
            pageLabel: response.match?.pageLabel || "",
          };
          openSelectionButton.disabled = false;
          void loadSavedAnnotations();
        } else {
          setStatus(response.error || "未能创建 PDF 原生高亮", "warn");
        }
      } else if (response?.queued) {
        setStatus(
          `Zotero 暂不可用，已保存到待同步队列：${response.error}`,
          "warn",
        );
      } else {
        setStatus(response?.error || "同步失败", "warn");
      }
    } catch (error) {
      if (state.anchor !== requestAnchor) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus(
        /Extension context invalidated/i.test(message)
          ? "扩展刚刚更新。请点击 Chrome 工具栏的 Translate Bridge for Zotero 图标重新载入，或刷新当前论文页。"
          : message,
        "warn",
      );
    } finally {
      clearTimeout(slowTimer);
      state.syncing = false;
      syncButton.disabled = !state.anchor || !isPdfAnchorReady(state.anchor);
    }
  }

  async function openDocumentInZotero() {
    openDocumentButton.disabled = true;
    setStatus("正在 Zotero 中打开这篇文章……");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "paperbridge:open-document",
        locator: documentLocator(),
      });
      setStatus(
        response?.ok
          ? "已在 Zotero 中打开这篇文章"
          : response?.error || "未能打开 Zotero 中的文章",
        response?.ok ? "good" : "warn",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(
        /Extension context invalidated/i.test(message)
          ? "扩展刚刚更新。请点击 Chrome 工具栏的 Translate Bridge for Zotero 图标重新载入。"
          : message,
        "warn",
      );
    } finally {
      openDocumentButton.disabled = false;
    }
  }

  async function openSelectionInZotero() {
    if (state.locating) return;
    if (!state.anchor || !isPdfAnchorReady(state.anchor)) return;
    state.locating = true;
    const requestAnchor = state.anchor;
    const started = Date.now();
    const slowTimer = setTimeout(() => {
      if (state.anchor === requestAnchor)
        setStatus(
          "仍在等待 PDF 读取或阅读器打开；超过时限会显示具体原因。",
          "warn",
          false,
        );
    }, 8000);
    openSelectionButton.disabled = true;
    setStatus("正在 PDF 全文中定位当前段落；首次读取可能需要几秒……");
    try {
      const response = state.openTarget
        ? await chrome.runtime.sendMessage({
            type: "paperbridge:open-annotation",
            target: state.openTarget,
          })
        : await chrome.runtime.sendMessage({
            type: "paperbridge:open-selection",
            annotation: selectionPayload(),
          });
      if (state.anchor !== requestAnchor) return;
      const page = response?.match?.pageLabel
        ? `第 ${response.match.pageLabel} 页`
        : "对应位置";
      setStatus(
        response?.ok
          ? `已在 Zotero 中打开${page}（${((Date.now() - started) / 1000).toFixed(1)} 秒${response.diagnostics?.cacheHit ? "，已复用缓存" : ""}）`
          : response?.error || "未能定位当前段落",
        response?.ok ? "good" : "warn",
      );
    } catch (error) {
      if (state.anchor !== requestAnchor) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus(
        /Extension context invalidated/i.test(message)
          ? "扩展刚刚更新。请刷新当前论文页后重试。"
          : message,
        "warn",
      );
    } finally {
      clearTimeout(slowTimer);
      state.locating = false;
      openSelectionButton.disabled =
        !state.anchor || !isPdfAnchorReady(state.anchor);
    }
  }

  async function openPanel(anchor = state.anchor) {
    if (anchor && anchor !== state.anchor) activateAnchor(anchor);
    if (state.anchor && !state.draftKey) {
      state.draftKey = anchorDraftKey(state.anchor);
      noteNode.value = state.drafts.get(state.draftKey) || "";
    }
    renderAnchor();
    panel.dataset.open = "true";
    button.dataset.visible = "false";
    if (!state.anchor) return;
    if (state.anchor.selectionIssue) {
      sourceState.textContent = "未匹配";
      sourceNode.textContent = "请重新选择论文正文";
      setStatus(state.anchor.selectionIssue, "warn");
      return;
    }
    if (state.translation) return;
    if (state.anchor.selectedLanguage === "zh") {
      void mapChineseSelection();
      return;
    }
    void translateSelection();
  }

  function showSelectionButton(anchor, rect) {
    activateAnchor(anchor);
    button.style.left = `${Math.min(window.innerWidth - 170, Math.max(12, rect.left))}px`;
    button.style.top = `${Math.min(window.innerHeight - 50, Math.max(12, rect.bottom + 8))}px`;
    button.dataset.visible = "true";
  }

  document.addEventListener("mouseup", (event) => {
    if (root.contains(event.target)) return;
    setTimeout(() => {
      const selection = window.getSelection();
      const anchor = buildAnchor(selection);
      if (!anchor) {
        button.dataset.visible = "false";
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (panel.dataset.open === "true") void openPanel(anchor);
      else showSelectionButton(anchor, rect);
    }, 0);
  });

  button.addEventListener("click", () => void openPanel(state.anchor));
  async function copyLocationDiagnostic(includeBoundary = false) {
    const targetButton = includeBoundary ? boundaryDetailsButton : diagnosticsButton;
    const request = ++diagnosticCopyRequest;
    clearTimeout(diagnosticResetTimer);
    targetButton.disabled = true;
    const report = {
      version: currentVersion,
      doi: extractDoi(),
      selectedCharacters: state.anchor?.exact?.length || 0,
      language: state.anchor?.selectedLanguage,
      originalSelectionLanguage: state.anchor?.selectionMode === "translated" ? "zh" : state.anchor?.selectedLanguage,
      mappingMethod: state.anchor?.mappingMethod || null,
      selectionIssue: state.anchor?.selectionIssue || null,
      excludedReferenceBlocks: state.anchor?.excludedReferenceBlocks || 0,
      blocks: (state.anchor?.parts || state.anchor?.diagnosticParts)?.map(part => {
        const { boundary, fragmentGroupFailure, ...summary } = part.sentenceDiagnostic || {};
        return {
          selectedCharacters: part.exact.length,
          paragraphCharacters: part.paragraph.length,
          ...summary,
          ...(fragmentGroupFailure ? { fragmentGroupFailure: includeBoundary ? fragmentGroupFailure : {
            reason: fragmentGroupFailure.reason, marker: fragmentGroupFailure.marker,
          } } : {}),
          ...(includeBoundary && !part.capturedSentenceSource ? { selectedText: part.exact.slice(0, 1500) } : {}),
          ...(includeBoundary && boundary ? { boundary } : {}),
        };
      }) || [],
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      if (request !== diagnosticCopyRequest) return;
      targetButton.textContent = includeBoundary ? "已复制句子边界详情" : "已复制诊断（不含正文或配对码）";
    } catch {
      if (request !== diagnosticCopyRequest) return;
      targetButton.textContent = "复制失败，请保持网页在前台后重试";
    } finally {
      if (request === diagnosticCopyRequest) {
        diagnosticsButton.disabled = boundaryDetailsButton.disabled = false;
        diagnosticResetTimer = setTimeout(() => {
          if (request === diagnosticCopyRequest) resetDiagnosticButtons();
        }, 1800);
      }
    }
  }
  diagnosticsButton.addEventListener("click", () => copyLocationDiagnostic());
  boundaryDetailsButton.addEventListener("click", () => copyLocationDiagnostic(true));
  closeButton.addEventListener("click", () => {
    panel.dataset.open = "false";
  });
  translateButton.addEventListener("click", runTextAction);
  syncButton.addEventListener("click", syncAnnotation);
  openDocumentButton.addEventListener("click", openDocumentInZotero);
  openSelectionButton.addEventListener("click", openSelectionInZotero);
  noteNode.addEventListener("input", saveCurrentDraft);
  for (const colorButton of colorButtons) {
    colorButton.addEventListener("click", () =>
      setHighlightColor(colorButton.dataset.color),
    );
  }
  sourceExpand.addEventListener("click", () =>
    toggleCard(sourceCard, sourceExpand, "展开原文"),
  );
  translationExpand.addEventListener("click", () =>
    toggleCard(translationCard, translationExpand, "展开译文"),
  );

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.dataset.open === "true") {
      panel.dataset.open = "false";
      return;
    }
    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      panel.dataset.open === "true" &&
      !syncButton.disabled
    ) {
      event.preventDefault();
      void syncAnnotation();
    }
  });

  // Read-only projection of existing Zotero annotations. CSS Highlights avoid
  // rewriting publisher/translation DOM and leave normal text selection intact.
  const savedSection = document.createElement("section");
  savedSection.className = "pb-saved-section";
  savedSection.innerHTML = `<details><summary>已有 Zotero 批注</summary><div class="pb-saved-content"><button type="button" class="pb-saved-refresh">刷新批注</button><div class="pb-saved-list"></div></div></details><details class="pb-management"><summary>文章工具</summary><div class="pb-library-actions"></div><p class="pb-saved-status" role="status">打开侧栏后读取已有批注</p></details>`;
  root.querySelector(".pb-body").prepend(savedSection);
  const savedStatus = savedSection.querySelector(".pb-saved-status");
  const savedList = savedSection.querySelector(".pb-saved-list");
  const savedRefresh = savedSection.querySelector(".pb-saved-refresh");
  const queueSettings = document.createElement('button'); queueSettings.type='button';queueSettings.textContent='管理待同步记录';
  queueSettings.onclick=()=>chrome.runtime.sendMessage({type:'paperbridge:settings'});savedSection.querySelector('.pb-library-actions').append(queueSettings);
  const addDocument=document.createElement('button');addDocument.type='button';addDocument.textContent='添加到 Zotero';
  addDocument.title='保存当前论文条目，并尝试获取可用PDF';savedSection.querySelector('.pb-library-actions').append(addDocument);
  addDocument.onclick=async()=>{
    addDocument.disabled=true;
    const value=name=>document.querySelector(`meta[name="${name}"]`)?.content || '';
    const metadata={title:value('citation_title')||document.title,doi:extractDoi(),url:document.querySelector('link[rel="canonical"]')?.href||location.href.split('#')[0],
      publicationTitle:value('citation_journal_title'),date:value('citation_publication_date')||value('citation_date'),volume:value('citation_volume'),issue:value('citation_issue'),ISSN:value('citation_issn'),
      authors:[...document.querySelectorAll('meta[name="citation_author"]')].map(meta=>meta.content)};
    try {
      savedStatus.textContent='正在保存论文条目…';
      let result=await chrome.runtime.sendMessage({type:'paperbridge:import-document',payload:{document:metadata}});
      if(!result?.ok)throw Error(result?.error||'添加失败');
      const itemID=result.itemID;
      savedStatus.textContent=result.existing?'文库已有这篇论文，未重复创建；正在检查PDF…':'论文条目已保存，正在获取可用PDF…';
      for(let i=0;i<40 && result.state==='fetching-pdf';i++) {
        await new Promise(resolve=>setTimeout(resolve,1500));
        result=await chrome.runtime.sendMessage({type:'paperbridge:import-document',payload:{action:'status',itemID}});
        if(!result?.ok)throw Error('条目已保存，但无法读取PDF获取状态，请在Zotero中检查。');
      }
      savedStatus.textContent=result.state==='pdf-saved'?'条目和 PDF 已在 Zotero 中保存。':result.state==='fetching-pdf'?'条目已保存，Zotero 仍在获取 PDF，请稍后检查。':'条目已保存，但未取得可用 PDF；可用 Zotero Connector 或手动添加附件。';
    }catch(error){savedStatus.textContent=error.message;}
    finally{addDocument.disabled=false;}
  };

  // Article notes deliberately do not depend on a selected quote or PDF match.
  const notesToggle=document.createElement('button'); notesToggle.type='button';notesToggle.textContent='文章笔记';
  notesToggle.className='pb-notes-toggle';savedSection.querySelector('.pb-library-actions').append(notesToggle);
  const notesPanel=document.createElement('section');notesPanel.className='pb-article-notes';notesPanel.hidden=true;
  notesPanel.innerHTML=`<div class="pb-note-tools"><select class="pb-note-list" aria-label="文章下的笔记"><option value="">新建文章笔记</option></select><button type="button" class="pb-note-refresh">重新读取</button></div><label>标题<input class="pb-note-title" maxlength="300" placeholder="文章阅读笔记"></label><label class="pb-note-body-label">笔记正文<textarea class="pb-note-body" placeholder="记录这篇文章的思路、证据与自己的判断，不需要选中正文。"></textarea></label><p class="pb-note-status" role="status">草稿保存在此浏览器，点击保存后写入 Zotero 文献下。</p><button type="button" class="pb-note-save">保存文章笔记到 Zotero</button>`;
  root.querySelector('.pb-body').append(notesPanel);
  const noteList=notesPanel.querySelector('.pb-note-list'), noteTitle=notesPanel.querySelector('.pb-note-title'),
    noteBody=notesPanel.querySelector('.pb-note-body'), noteStatus=notesPanel.querySelector('.pb-note-status'),
    noteSave=notesPanel.querySelector('.pb-note-save'), noteRefresh=notesPanel.querySelector('.pb-note-refresh');
  let noteDocument=null,noteIdentity=null,noteRows=[],noteKey='',noteExpected='',noteRequest=0,noteEditable=true;
  const noteDocKey=()=>JSON.stringify(noteDocument?.document?.doi || noteDocument?.document?.url || '');
  const draftKey=()=>`pb.article-note.${noteDocKey()}.${noteKey||'new'}`;
  let draftWrite=Promise.resolve();
  function storeNoteDraft() {
    if(!noteDocument || !noteEditable)return draftWrite;
    const key=draftKey(),value={title:noteTitle.value,text:noteBody.value,identity:noteIdentity,expectedHTML:noteExpected};
    draftWrite=draftWrite.catch(()=>{}).then(()=>chrome.storage.local.set({[key]:value}));
    return draftWrite;
  }
  const simpleNote=html=>{
    const template=document.createElement('template');template.innerHTML=html;
    const rich=[...template.content.querySelectorAll('*')].some(el=>!['DIV','H1','P','BR'].includes(el.tagName));
    const title=template.content.querySelector('h1')?.textContent || '';
    const text=[...template.content.querySelectorAll('p')].map(p=>p.textContent).join('\n');
    return {title,text,editable:!rich && Boolean(title)};
  };
  async function chooseNote() {
    const key=noteList.value,serial=++noteRequest;
    noteKey=key;const row=noteRows.find(n=>n.key===key); noteExpected=row?.html||'';
    const value=row?simpleNote(row.html):{title:'',text:'',editable:true};
    noteTitle.value=value.title||row?.title||'';noteBody.value=value.text;
    noteEditable=value.editable;noteTitle.disabled=noteBody.disabled=noteSave.disabled=!noteEditable;
    noteStatus.textContent=noteEditable?'纯文本文章笔记；修改自动保留为本地草稿。':'这条笔记含其他格式，请在 Zotero 中编辑以保留原格式；可在列表中新建笔记。';
    const keyToRead=draftKey();
    try {
      const cached=(await chrome.storage.local.get({[keyToRead]:null}))[keyToRead];
      if(serial!==noteRequest || !cached || !noteEditable)return;
      noteTitle.value=cached.title;noteBody.value=cached.text;noteExpected=cached.expectedHTML;
      if(cached.identity && JSON.stringify(cached.identity)!==JSON.stringify(noteIdentity)) {
        noteSave.disabled=true;noteStatus.textContent='草稿属于另一文库或文献条目，已保留但不会写入当前条目。';
      } else noteStatus.textContent='已恢复本地草稿；尚未保存的内容仍在这里。';
    }catch(error){noteStatus.textContent=`读取草稿失败：${error.message}`;}
  }
  async function loadArticleNotes() {
    noteRefresh.disabled=noteSave.disabled=true;
    try {
      const response=await chrome.runtime.sendMessage({type:'paperbridge:article-notes',payload:{action:'list',...noteDocument}});
      if(!response?.ok)throw Error(response?.error||'读取文章笔记失败');
      noteIdentity={parentID:response.parentID,libraryID:response.libraryID,parentKey:response.parentKey};
      noteRows=response.notes||[];noteList.replaceChildren(new Option('新建文章笔记',''));
      for(const row of noteRows)noteList.append(new Option(row.title||'无标题笔记',row.key));
      if(noteRows.some(row=>row.key===noteKey))noteList.value=noteKey;
      await chooseNote();
    }catch(error){noteStatus.textContent=error.message;}
    finally{noteRefresh.disabled=false;}
  }
  noteList.onchange=async()=>{await storeNoteDraft();await chooseNote();};
  noteRefresh.onclick=async()=>{await storeNoteDraft();await loadArticleNotes();};
  for(const input of [noteTitle,noteBody])input.oninput=()=>{
    storeNoteDraft().then(()=>{noteStatus.textContent='本地草稿已保存，尚未写入 Zotero。';}).catch(error=>{noteStatus.textContent=`草稿保存失败：${error.message}`;});
  };
  notesToggle.onclick=async()=>{
    const opening=notesPanel.hidden;
    if(!opening)await storeNoteDraft();
    notesPanel.hidden=!opening;root.querySelector('.pb-reading-scroll').hidden=opening;root.querySelector('.pb-dock').hidden=opening;
    notesToggle.textContent=opening?'返回阅读':'文章笔记';
    if(opening){noteDocument=documentLocator();await loadArticleNotes();}
  };
  noteSave.onclick=async()=>{
    if(!noteIdentity || noteSave.disabled)return;
    if(noteDocument.document.url!==location.href){noteStatus.textContent='网页已切换，请重新打开文章笔记；草稿仍保留。';return;}
    const oldDraft=draftKey();
    noteSave.disabled=noteTitle.disabled=noteBody.disabled=noteList.disabled=noteRefresh.disabled=true;
    try {
      await storeNoteDraft();
      const response=await chrome.runtime.sendMessage({type:'paperbridge:article-notes',payload:{action:'save',...noteDocument,...noteIdentity,key:noteKey,expectedHTML:noteExpected,title:noteTitle.value,text:noteBody.value}});
      if(!response?.ok)throw Error(response?.error||'保存失败');
      noteKey=response.note.key;noteExpected=response.note.html;
      await chrome.storage.local.set({[oldDraft]:null});
      await loadArticleNotes();noteStatus.textContent='已保存到对应 Zotero 文献下的文章笔记。';
    }catch(error){noteStatus.textContent=`${error.message}（草稿保留）`;}
    finally{noteSave.disabled=noteTitle.disabled=noteBody.disabled=!noteEditable;noteList.disabled=noteRefresh.disabled=false;}
  };

  let savedAnnotations = [], savedRanges = [], savedRequest = 0, savedTimer;
  const savedDrafts = new Map();
  const savedIdentity = a => `${a.attachmentID}:${a.annotationKey}`;
  let savedLoadedUrl = "";
  const highlightStyle = document.createElement("style");
  root.append(highlightStyle);
  const quoteKey = text => String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  function clearSavedHighlights() {
    for (const hit of savedRanges) globalThis.CSS?.highlights?.delete(hit.name);
    savedRanges = []; highlightStyle.textContent = "";
  }
  function locateSavedQuote(annotation) {
    const needle = quoteKey(annotation.text);
    if (needle.length < 12) return null;
    const found = [];
    const addFound=range=>{if(!found.some(other=>range.compareBoundaryPoints(Range.START_TO_START,other)===0 && range.compareBoundaryPoints(Range.END_TO_END,other)===0))found.push(range);};
    const containers = [...document.querySelectorAll("p,li,blockquote,figcaption,td,th,h1,h2,h3,h4,h5,h6,div")]
      .filter(el => !root.contains(el) && !el.querySelector("p,li,blockquote,figcaption,td,th,div") && el.getClientRects().length);
    for (const el of containers) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let normalized = ""; const positions = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement.closest("script,style,noscript,[hidden]")) continue;
        const visible = document.createRange(); visible.selectNodeContents(node);
        if (!visible.getClientRects().length) continue;
        for (let i = 0; i < node.length;) {
          const ch = String.fromCodePoint(node.textContent.codePointAt(i));
          const key = quoteKey(ch);
          normalized += key;
          for (let j = 0; j < key.length; j++) positions.push({ node, start: i, end: i + ch.length });
          i += ch.length;
        }
      }
      let at = normalized.indexOf(needle);
      while (at >= 0) {
        const first = positions[at], last = positions[at + needle.length - 1];
        const range = document.createRange(); range.setStart(first.node, first.start); range.setEnd(last.node, last.end);
        addFound(range); at = normalized.indexOf(needle, at + 1);
        if (found.length > 1) return null;
      }
      // Translated text is eligible only when existing sentence mapping proves
      // the exact complete source quote; partial or drifted markers stay listed.
      if (/[\u3400-\u9fff]/.test(el.textContent)) {
        const spans = [...el.querySelectorAll("[data-pb-sentence]")];
        const paragraph = capturedOriginal(el);
        if (paragraph && quoteKey(paragraph) === needle) {
          const range = document.createRange(); range.selectNodeContents(el);
          if (capturedSentenceSelection(el, range, paragraph)) { addFound(range); continue; }
        }
        const groups = sentenceGroups(el, spans, paragraph);
        if (!groups) continue;
        const bounds = groupedSentenceRanges(groups);
        const units=[];
        for(let i=0;i<groups.length;i++) {
          const record=groups[i].saved;
          const aligned=alignedSentenceParts(bounds[i],record.text);
          units.push(...(aligned.length?aligned:[{original:record.text,range:bounds[i]}]));
        }
        for(let i=0;i<units.length;i++) {
          let source='';
          for(let j=i;j<units.length && units[j];j++) {
            source+=quoteKey(units[j].original);
            if(!needle.startsWith(source))break;
            if(source===needle) {
              const range=units[i].range.cloneRange();range.setEnd(units[j].range.endContainer,units[j].range.endOffset);
              const verified=paragraph && capturedSentenceSelection(el,range,paragraph);
              if(verified && quoteKey(verified)===needle) {
                addFound(range);
              }
              break;
            }
          }
        }

      }
      if (found.length > 1) return null;
    }
    const distinct=found.filter((range,i)=>!found.slice(0,i).some(other=>range.compareBoundaryPoints(Range.START_TO_START,other)===0 && range.compareBoundaryPoints(Range.END_TO_END,other)===0));
    return distinct.length === 1 ? distinct[0] : null;
  }
  function renderSavedAnnotations() {
    clearSavedHighlights(); savedList.replaceChildren();
    if (savedLoadedUrl !== location.href.split("#")[0]) return;
    savedAnnotations.forEach((annotation, index) => {
      const card = document.createElement("article"); card.className = "pb-saved-card";
      const color = /^#[0-9a-f]{6}$/i.test(annotation.color || "") ? annotation.color : "#ffd400";
      card.style.borderLeftColor = color;
      const range = locateSavedQuote(annotation);
      const meta = document.createElement("p");
      meta.textContent = `第 ${annotation.pageLabel || "?"} 页 · ${range ? "已定位网页" : "仅侧栏显示，未可靠定位"}`;
      const quote = document.createElement("blockquote"); quote.textContent = annotation.text || "非文字批注";
      const comment = document.createElement("p");
      // Comments may contain rich-text HTML. Parse inertly and insert text only.
      const inertComment = document.createElement("template");
      inertComment.innerHTML = annotation.comment || "";
      comment.textContent = inertComment.content.textContent;
      const open = document.createElement("button"); open.type = "button"; open.textContent = "在 Zotero 中打开";
      open.addEventListener("click", async () => {
        try {
          const result = await chrome.runtime.sendMessage({type:"paperbridge:open-annotation",target:{attachmentID:annotation.attachmentID,annotationKey:annotation.annotationKey}});
          if (!result?.ok) savedStatus.textContent = result?.error || "打开批注失败";
        } catch (error) { savedStatus.textContent = error.message; }
      });
      const actions=document.createElement('div'); actions.className='pb-annotation-actions';
      actions.append(open); card.append(meta, quote, comment, actions); savedList.append(card);
      card.dataset.annotation = savedIdentity(annotation);
      const edit = document.createElement('button'); edit.type='button'; edit.textContent='编辑内容';
      const remove = document.createElement('button'); remove.type='button'; remove.textContent='删除批注';
      remove.className='pb-delete-annotation';
      const editor = document.createElement('textarea'); editor.setAttribute('aria-label','编辑批注内容（含已有译文和笔记）'); editor.hidden=true;
      const save = document.createElement('button'); save.type='button'; save.textContent='保存到 Zotero'; save.hidden=true;
      const cancel = document.createElement('button'); cancel.type='button'; cancel.textContent='取消'; cancel.hidden=true;
      const identity = savedIdentity(annotation);
      const editing = active => {editor.hidden=save.hidden=cancel.hidden=!active;edit.hidden=active;};
      edit.onclick=()=>{editor.value=savedDrafts.get(identity)?.value ?? comment.textContent;savedDrafts.set(identity,{value:editor.value,expected:annotation.comment||''});editing(true);editor.focus();};
      editor.oninput=()=>savedDrafts.set(identity,{value:editor.value,expected:savedDrafts.get(identity)?.expected ?? (annotation.comment||'')});
      cancel.onclick=()=>{savedDrafts.delete(identity);editing(false);};
      const mutate = async action => {
        save.disabled=remove.disabled=cancel.disabled=edit.disabled=true;
        try {
          const response=await chrome.runtime.sendMessage({type:'paperbridge:mutate-annotation',payload:{action,attachmentID:annotation.attachmentID,annotationKey:annotation.annotationKey,expectedComment:action==='edit'?(savedDrafts.get(identity)?.expected ?? (annotation.comment||'')):(annotation.comment||''),comment:editor.value}});
          if(!response?.ok) throw Error(response?.error || '操作失败');
          savedDrafts.delete(identity); await loadSavedAnnotations();
        } catch(error) {savedStatus.textContent=error.message;}
        finally {save.disabled=remove.disabled=cancel.disabled=edit.disabled=false;}
      };
      save.onclick=()=>mutate('edit');remove.onclick=()=>mutate('delete');
      actions.append(edit,remove); card.append(editor,save,cancel);
      if(savedDrafts.has(identity)){editor.value=savedDrafts.get(identity).value;editing(true);}
      if (range && globalThis.CSS?.highlights && globalThis.Highlight) {
        const name = `pb-saved-${index}`;
        CSS.highlights.set(name, new Highlight(range));
        highlightStyle.textContent += `::highlight(${name}){background-color:${color}70;text-decoration:underline ${color};}`;
        savedRanges.push({name,range,card});
        const locate = document.createElement("button"); locate.type = "button"; locate.textContent = "查看网页位置";
        locate.addEventListener("click", () => range.startContainer.parentElement.scrollIntoView({block:"center",behavior:"smooth"}));
        actions.insertBefore(locate,edit);
      }
    });
    savedStatus.textContent = `共 ${savedAnnotations.length} 条批注，${savedRanges.length} 条已标到网页。`;
  }
  async function loadSavedAnnotations() {
    const request = ++savedRequest, url = location.href.split("#")[0];
    savedRefresh.disabled = true; savedStatus.textContent = "正在读取 Zotero 批注…";
    try {
      const response = await chrome.runtime.sendMessage({type:"paperbridge:list-annotations",locator:documentLocator()});
      if (request !== savedRequest || url !== location.href.split("#")[0]) return;
      clearSavedHighlights(); savedList.replaceChildren(); savedAnnotations = []; savedLoadedUrl = url;
      if (!response?.ok) { savedStatus.textContent = response?.error || "无法读取批注，请确认 Zotero 已打开且两端插件均已更新"; return; }
      savedAnnotations = response.annotations || []; renderSavedAnnotations();
    } catch (error) {
      if (request === savedRequest) {
        clearSavedHighlights(); savedAnnotations = []; savedList.replaceChildren();
        savedStatus.textContent = error.message;
      }
    }
    finally { if (request === savedRequest) savedRefresh.disabled = false; }
  }
  savedRefresh.addEventListener("click", loadSavedAnnotations);
  document.addEventListener("click", event => {
    if (root.contains(event.target) || getSelection()?.toString()) return;
    const hit = savedRanges.find(hit => [...hit.range.getClientRects()].some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom));
    if (hit) {
      panel.dataset.open = "true"; savedSection.querySelector("details").open = true;
      const hits=savedRanges.filter(entry=>[...entry.range.getClientRects()].some(rect=>event.clientX>=rect.left && event.clientX<=rect.right && event.clientY>=rect.top && event.clientY<=rect.bottom));
      const previous=hits.findIndex(entry=>entry.card.classList.contains('pb-saved-active'));
      savedList.querySelectorAll('.pb-saved-active').forEach(card=>card.classList.remove('pb-saved-active'));
      const target=hits[(previous+1)%hits.length];target.card.classList.add('pb-saved-active');
      requestAnimationFrame(()=>target.card.scrollIntoView({block:"center",behavior:"smooth"}));
      if(hits.length>1)savedStatus.textContent=`此处有 ${hits.length} 条重叠批注，再次点击可切换。`;
    }
  });
  new MutationObserver(records => {
    if (!savedAnnotations.length || records.every(record => root.contains(record.target))) return;
    clearTimeout(savedTimer); savedTimer = setTimeout(renderSavedAnnotations, 700);
  }).observe(document.documentElement, {subtree:true,childList:true,characterData:true});
  const autoLoadSaved = () => { if (extractDoi()) void loadSavedAnnotations(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoLoadSaved, {once:true});
  else autoLoadSaved();

  let webJumpGeneration=0;
  async function receiveWebSelection() {
    const ticket=location.hash.match(/^#pb-web=([A-Za-z0-9]{32})$/)?.[1];
    if(!ticket)return;
    const generation=++webJumpGeneration;
    panel.dataset.open="true";
    savedStatus.textContent='正在定位 PDF 选中的文字…';
    try {
      const response=await chrome.runtime.sendMessage({type:'paperbridge:web-selection',payload:{ticket,doi:extractDoi(),url:location.href.split('#')[0]}});
      if(generation!==webJumpGeneration)return;
      if(!response?.ok)throw Error(response?.error || '无法读取PDF选区');
      let range;
      for(let attempt=0;attempt<20;attempt++) {
        if(generation!==webJumpGeneration)return;
        range=locateSavedQuote({text:response.exact});
        if(range)break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      if(!range)throw Error('已打开网页，但未可靠定位PDF选区。请确认网页有全文，或恢复英文后重试。');
      if(globalThis.CSS?.highlights && globalThis.Highlight){
        CSS.highlights.set('pb-web-selection',new Highlight(range));
        const style=document.createElement('style');style.textContent='::highlight(pb-web-selection){background:#ffe477;text-decoration:underline;}';root.append(style);
        setTimeout(()=>{CSS.highlights.delete('pb-web-selection');style.remove();},15000);
      }
      range.startContainer.parentElement.scrollIntoView({block:'center',behavior:'smooth'});
      savedStatus.textContent='已定位 PDF 选区对应的网页文字。';
    } catch(error) {if(generation===webJumpGeneration)savedStatus.textContent=error.message;}
  }
  window.addEventListener('hashchange',receiveWebSelection);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',receiveWebSelection,{once:true});else void receiveWebSelection();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "paperbridge:toggle") {
      if (panel.dataset.open === "true") panel.dataset.open = "false";
      else { void openPanel(state.anchor); void loadSavedAnnotations(); }
    }
  });
})();
