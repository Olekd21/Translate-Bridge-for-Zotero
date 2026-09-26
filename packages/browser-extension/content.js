(() => {
  const currentVersion = "1.0.6";
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
  const originalTextById = new Map();
  const originalTextBySentence = new WeakMap();
  const sentenceByKey = new Map();
  let nextSentenceKey = 0;
  const textContainerSelector =
    "p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6, div";

  const root = document.createElement("div");
  root.id = "paper-bridge-root";
  root.classList.add("notranslate");
  root.setAttribute("translate", "no");
  root.innerHTML = `
    <button class="pb-selection-button" type="button" aria-label="用 Translate Bridge for Zotero 阅读这段文字">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h13M6.5 6.8 3.3 10l3.2 3.2M13.5 6.8l3.2 3.2-3.2 3.2"/></svg>
      <span>翻译并做笔记</span>
    </button>
    <aside class="pb-panel" aria-label="Translate Bridge for Zotero 批注侧栏" data-open="false">
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
          <button class="pb-action pb-diagnostics" type="button" hidden>复制定位诊断</button>
          <button class="pb-action pb-boundary-details" type="button" hidden>复制边界详情（含当前句子）</button>
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

  function setStatus(text, tone = "neutral") {
    statusNode.textContent = text;
    statusNode.dataset.tone = tone;
    diagnosticsButton.hidden = tone !== "warn" || state.anchor?.selectedLanguage !== "zh";
    boundaryDetailsButton.hidden = diagnosticsButton.hidden;
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
    saveCurrentDraft();
    state.mappingRequestId += 1;
    state.mappingInProgress = false;
    state.anchor = anchor;
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
        if (/^H[1-6]$/.test(sibling.tagName)) return sibling.textContent.trim();
        const nested = sibling.querySelector?.("h1, h2, h3, h4, h5, h6");
        if (nested?.textContent?.trim()) return nested.textContent.trim();
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
    const segments = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(raw));
    if (segments.length < 2 || segments.length > 100) return;
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

  function sentenceRanges(element, spans) {
    const ranges = [...spans].map(span => {
      const range = document.createRange(); range.selectNodeContents(span); return range;
    });
    for (let i = 0; i + 1 < spans.length; i++) {
      const current = spans[i], next = spans[i + 1];
      if (current.contains(next) || current.querySelector("[data-pb-sentence]")) continue;
      const tail = current.textContent.match(/[。！？][”’」』）)\]]*\s*([A-Za-z][A-Za-z‐‑‒–—-]{0,23})\s*$/u);
      const continuation = next.textContent.match(/^\s*([-‐‑‒–—]\s*[A-Za-z][A-Za-z0-9‐‑‒–—-]*)/u);
      const saved = sentenceRecord(next, element);
      const currentSaved = sentenceRecord(current, element);
      if (!tail || !continuation || !saved || !currentSaved || !/[.!?][)\]"']*$/.test(currentSaved.text)) continue;
      const normalizeToken = value => value.toLowerCase().replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, "");
      const token = normalizeToken(tail[1] + continuation[1]);
      // Only repair a split hyphenated term independently present in the next
      // English sentence. Do not accept arbitrary extra words or Chinese clauses.
      if (!normalizeToken(saved.text).includes(token)) continue;
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

  function capturedSentenceSelection(element, selectionRange, originalParagraph, diagnostic = {}) {
    const pieces = [];
    const spans = element.querySelectorAll("[data-pb-sentence]");
    diagnostic.sentenceAnchors = spans.length;
    diagnostic.hasEnglishParagraph = Boolean(originalParagraph);
    diagnostic.reason = spans.length ? "no-selected-sentence" : "no-sentence-anchors";
    const logicalRanges = sentenceRanges(element, spans);
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
      const saved = sentenceRecord(span, element);
      if (!saved || saved.paragraph !== element || saved.url !== location.href.split("#")[0]) {
        diagnostic.reason = "sentence-cache-missing"; return null;
      }
      if (!originalParagraph.includes(saved.text)) {
        diagnostic.reason = "sentence-source-mismatch"; return null;
      }
      if ((bounds.toString().match(/[。！？]/g) || []).length > 1 && spans[index + 1] &&
          !compactChinese(spans[index + 1].textContent) && sentenceRecord(spans[index + 1], element)) {
        diagnostic.reason = "translation-collapsed-sentences"; return null;
      }
      if (compactChinese(selected) !== compactChinese(bounds.toString())) {
        const before = bounds.cloneRange();
        before.setEnd(range.startContainer, range.startOffset);
        const after = bounds.cloneRange();
        after.setStart(range.endContainer, range.endOffset);
        diagnostic.boundary = {
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
      pieces.push({ selected, original: saved.text });
    }
    diagnostic.selectedSentences = pieces.length;
    if (!pieces.length) return null;
    if (compactChinese(pieces.map(p => p.selected).join(" ")) !== compactChinese(selectionRange.toString())) {
      diagnostic.reason = "uncovered-selection-text"; return null;
    }
    const source = pieces.map(p => p.original).join(" ");
    diagnostic.reason = originalParagraph.includes(source) ? "captured" : "noncontiguous-source";
    return originalParagraph.includes(source) ? source : null;
  }

  function buildAnchor(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      return null;
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) return null;
    const exact = normalizedReadableText(selection.toString());
    if (exact.length < 3) return null;

    const container = nearestTextContainer(range.commonAncestorContainer);
    const paragraph = normalizedReadableText(container.textContent);
    const pageContainers = Array.from(
      document.querySelectorAll(textContainerSelector),
    ).filter((element) => !root.contains(element) && isTextContainer(element));
    const parts = [];
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
      const id = element.id || "";
      const uniqueId =
        id &&
        document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1;
      const sentenceDiagnostic = {};
      const capturedSentenceSource = capturedSentenceSelection(element, clipped, capturedOriginal(element), sentenceDiagnostic);
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
        sentenceDiagnostic,
      });
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

    return {
      exact,
      prefix,
      suffix,
      paragraph,
      originalParagraph: capturedOriginal(container),
      containerIndex: pageContainers.indexOf(container),
      containerId: parts.length === 1 ? parts[0].containerId : "",
      parts,
      sectionHeading: findHeading(container),
      selectedLanguage: /[\u3400-\u9fff]/.test(exact) ? "zh" : "en",
    };
  }

  function compactChinese(value) {
    return normalizedReadableText(value)
      .toLocaleLowerCase("zh-CN")
      .replace(/[\s\p{P}\p{S}]+/gu, "");
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
        new Intl.Segmenter("en", { granularity: "sentence" }).segment(
          paragraph,
        ),
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
        new Intl.Segmenter(locale, { granularity: "sentence" }).segment(text),
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
    const compactParagraph = compactChinese(translatedParagraph);
    const compactSelected = compactChinese(selectedText);
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
    const candidates = [paragraph, ...sentences];
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
    if (anchor.parts?.length) {
      if (anchor.parts.length > 8)
        throw new Error("选区超过 8 个文字块，请分段选择。");
      if (
        compactChinese(anchor.parts.map((part) => part.exact).join(" ")) !==
        compactChinese(anchor.exact)
      )
        throw new Error("选区包含未识别的文字块，请分别选择正文段落。");
      const mapped = [];
      for (const part of anchor.parts)
        mapped.push(
          await mapTranslatedSelection({ ...part, selectedLanguage: "zh" }),
        );
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
        translatedParagraph: anchor.paragraph,
        selectedLanguage: "en",
        selectionMode: "translated",
        parts: undefined,
        mappingMethod: "verified-blocks",
        mappingScore: Math.min(...mapped.map((part) => part.mappingScore)),
      };
    }
    const originalParagraph = await recoverOriginalParagraph(anchor);
    if (anchor.capturedSentenceSource && originalParagraph.includes(anchor.capturedSentenceSource))
      return mappedEnglishAnchor(anchor, originalParagraph, anchor.capturedSentenceSource, 1, "captured-sentence-range");
    // A stale/copied sentence marker must not be bypassed by treating the
    // changed paragraph as a whole-paragraph translation of its old snapshot.
    const hasUnverifiedSentenceMarkers =
      anchor.sentenceDiagnostic?.sentenceAnchors > 0 &&
      anchor.sentenceDiagnostic.reason !== "captured";
    const fastMatch = hasUnverifiedSentenceMarkers
      ? null
      : fastPositionMapping(anchor, originalParagraph);
    if (fastMatch) return fastMatch;
    const candidates = shortlistMappingCandidates(anchor, originalParagraph);
    const translator = await getTranslator();
    const selected = compactChinese(anchor.exact);
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
      const score = bigramSimilarity(selected, compactChinese(translated));
      ranked.push({ source: candidate, translated, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (
      !best ||
      best.score < 0.78 ||
      (ranked[1] && best.score - ranked[1].score < 0.1)
    ) {
      throw new Error(
        "没有可靠地反查到对应英文；请尽量选择一个完整句子或连续段落。",
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
    sourceLabel.textContent = "PDF 定位原文";
    sourceState.textContent = isChineseSelection ? "待匹配" : "英文锚点";
    translationState.textContent = isChineseSelection ? "网页译文" : "阅读译文";
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

    state.translating = true;
    updateTextAction();
    translationNode.textContent = "正在调用 Chrome 本地翻译……";
    refreshExpansionControls();
    setStatus("正在翻译；首次使用可能需要下载语言包");
    try {
      const translator = await getTranslator();
      state.translation = await translator.translate(
        state.anchor.exact.slice(0, 5000),
      );
      translationNode.textContent = state.translation;
      refreshExpansionControls(true);
      setStatus("译文已生成，原文锚点保持不变", "good");
    } catch (error) {
      state.translation = "";
      translationNode.textContent = "未生成译文";
      refreshExpansionControls();
      setStatus(error instanceof Error ? error.message : String(error), "warn");
    } finally {
      state.translating = false;
      updateTextAction();
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
      const mappedAnchor = await withTimeout(
        mapTranslatedSelection(state.anchor),
        15000,
        "英文原文匹配超过 15 秒，已停止。请重新选择完整句子或段落。",
      );
      if (requestId !== state.mappingRequestId) return;
      state.anchor = mappedAnchor;
      state.translation = translatedSelection;
      renderAnchor();
      setStatus("已匹配英文原文，可同步为 Zotero PDF 高亮", "good");
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

  function runTextAction() {
    if (state.anchor?.selectedLanguage === "zh") {
      void mapChineseSelection();
      return;
    }
    if (state.anchor?.selectionMode === "translated") {
      const translatedAnchor = {
        ...state.anchor,
        exact: state.anchor.translatedSelection,
        paragraph: state.anchor.translatedParagraph,
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
      blocks: state.anchor?.parts?.map(part => {
        const { boundary, ...summary } = part.sentenceDiagnostic || {};
        return {
          selectedCharacters: part.exact.length,
          paragraphCharacters: part.paragraph.length,
          ...summary,
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "paperbridge:toggle") {
      if (panel.dataset.open === "true") panel.dataset.open = "false";
      else void openPanel(state.anchor);
    }
  });
})();
