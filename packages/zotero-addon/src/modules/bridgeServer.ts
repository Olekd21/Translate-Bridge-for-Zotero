import pkg from "../../package.json";
import { type TextQuoteSelector } from "./textMatcher";
import {
  locateQuoteGeometry,
  type GeometryMatch,
  type RecognizerData,
} from "./pdfGeometry";

const { config } = pkg;
const PING_PATH = "/paperbridge/ping";
const ANNOTATION_PATH = "/paperbridge/annotations";
const OPEN_PATH = "/paperbridge/open";
const OPEN_DOCUMENT_PATH = "/paperbridge/open-document";
const OPEN_SELECTION_PATH = "/paperbridge/open-selection";
const TOKEN_PREF = `${config.prefsPrefix}.pairingToken`;

type BridgeAnnotation = {
  schemaVersion: number;
  id: string;
  createdAt: string;
  document: {
    doi?: string;
    url?: string;
    canonicalUrl?: string;
    title?: string;
  };
  selector: TextQuoteSelector;
  context?: {
    paragraph?: string;
    sectionHeading?: string;
  };
  translation?: string;
  comment?: string;
  color?: string;
  annotationKey?: string;
};

type EndpointRequest = {
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
};

type OpenAnnotationRequest = {
  attachmentID?: number;
  annotationKey?: string;
};

type OpenDocumentRequest = Pick<BridgeAnnotation, "document">;

function jsonResponse(status: number, payload: unknown) {
  return [status, "application/json", JSON.stringify(payload)];
}

function parseBody(request: EndpointRequest): BridgeAnnotation {
  const data = request.data;
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("请求正文必须是 JSON 对象");
  }
  return parsed as BridgeAnnotation;
}

function parseOpenBody(request: EndpointRequest): OpenAnnotationRequest {
  const data = request.data;
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("请求正文必须是 JSON 对象");
  }
  return parsed as OpenAnnotationRequest;
}

function parseDocumentBody(request: EndpointRequest): OpenDocumentRequest {
  const data = request.data;
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("请求正文必须是 JSON 对象");
  }
  return parsed as OpenDocumentRequest;
}

function requestHeader(request: EndpointRequest, name: string): string {
  const wanted = name.toLocaleLowerCase("en-US");
  const pair = Object.entries(request.headers || {}).find(
    ([key]) => key.toLocaleLowerCase("en-US") === wanted,
  );
  return pair ? String(pair[1]) : "";
}

function normalizeDOI(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLocaleLowerCase("en-US");
}

function normalizeAnnotationColor(value: unknown): string {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#ffd400";
}

export function getOrCreatePairingToken(): string {
  const existing = String(Zotero.Prefs.get(TOKEN_PREF, true) || "").trim();
  if (existing) return existing;

  const bytes = new Uint8Array(32);
  const crypto = ztoolkit.getGlobal("crypto") as Crypto;
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  Zotero.Prefs.set(TOKEN_PREF, token, true);
  return token;
}

type ParentSelection = {
  item: any;
  reason: "selected-item" | "newest-duplicate" | "only-match";
  candidateCount: number;
};

function selectedRegularItem(): any | null {
  try {
    const selected = Zotero.getActiveZoteroPane().getSelectedItems()[0];
    if (!selected) return null;
    if (selected.isAttachment?.() && selected.parentID) {
      return Zotero.Items.get(selected.parentID) || null;
    }
    return selected.isRegularItem?.() ? selected : null;
  } catch {
    return null;
  }
}

function newestFirst(left: any, right: any) {
  const timestamp = (item: any) =>
    Date.parse(String(item?.dateAdded || "").replace(" ", "T")) || 0;
  return timestamp(right) - timestamp(left);
}

async function findParentItem(
  annotation: Pick<BridgeAnnotation, "document">,
): Promise<ParentSelection | null> {
  let candidates: any[] = [];
  const doi = normalizeDOI(annotation.document?.doi);
  if (doi) {
    const search = new Zotero.Search();
    search.addCondition("DOI", "is", doi);
    const ids = await search.search();
    candidates = ids.map((id) => Zotero.Items.get(id)).filter(Boolean);
    if (!candidates.length) {
      const fallbackNeedle = doi.match(/[a-z0-9]{6,}$/)?.[0] || doi.slice(-12);
      const fallbackSearch = new Zotero.Search();
      fallbackSearch.addCondition("DOI", "contains", fallbackNeedle);
      const fallbackIDs = await fallbackSearch.search();
      candidates = fallbackIDs
        .map((id) => Zotero.Items.get(id))
        .filter((item) => item && normalizeDOI(item.getField?.("DOI")) === doi);
    }
  }

  const title = String(annotation.document?.title || "").trim();
  if (!candidates.length && title) {
    const search = new Zotero.Search();
    search.addCondition("title", "contains", title.slice(0, 120));
    const ids = await search.search();
    candidates = ids.map((id) => Zotero.Items.get(id)).filter(Boolean);
  }
  if (!candidates.length) return null;

  const selected = selectedRegularItem();
  const selectedMatch = selected
    ? candidates.find((candidate) => candidate.id === selected.id)
    : null;
  if (selectedMatch) {
    return {
      item: selectedMatch,
      reason: "selected-item",
      candidateCount: candidates.length,
    };
  }

  candidates.sort(newestFirst);
  return {
    item: candidates[0],
    reason: candidates.length > 1 ? "newest-duplicate" : "only-match",
    candidateCount: candidates.length,
  };
}

function firstPdfAttachment(parent: any) {
  const attachmentIDs: number[] = parent.isAttachment()
    ? [parent.id]
    : parent.getAttachments();
  return attachmentIDs
    .map((id) => Zotero.Items.get(id))
    .find((item) => item?.isPDFAttachment?.());
}

async function findPDFMatch(
  parent: any,
  selector: TextQuoteSelector,
): Promise<{ attachment?: any; match: GeometryMatch }> {
  const attachment = firstPdfAttachment(parent);

  if (!attachment) {
    return { match: { status: "not-found", occurrences: 0 } };
  }

  try {
    const result = (await (Zotero.PDFWorker as any).getRecognizerData(
      attachment.id,
      true,
    )) as RecognizerData;
    return {
      attachment,
      match: locateQuoteGeometry(result, selector),
    };
  } catch (error) {
    ztoolkit.log("Translate Bridge for Zotero PDF geometry extraction failed", error);
    return {
      attachment,
      match: { status: "not-found", occurrences: 0 },
    };
  }
}

function pageLabelFor(parent: any, pageIndex: number) {
  const pages = String(parent.getField?.("pages") || "");
  const firstPrintedPage = Number(pages.match(/^\s*(\d+)/)?.[1]);
  if (Number.isFinite(firstPrintedPage)) {
    return String(firstPrintedPage + pageIndex);
  }
  return String(pageIndex + 1);
}

export function annotationComment(annotation: BridgeAnnotation) {
  const parts: string[] = [];
  if (annotation.comment?.trim()) {
    parts.push(`我的笔记：\n${annotation.comment.trim()}`);
  }
  if (annotation.translation?.trim()) {
    parts.push(`中文翻译：\n${annotation.translation.trim()}`);
  }
  return parts.join("\n\n");
}

async function saveNativeHighlight(
  parent: any,
  attachment: any,
  annotation: BridgeAnnotation,
  match: GeometryMatch,
) {
  if (match.pageIndex === undefined || !match.rects?.length) {
    throw new Error("缺少 PDF 原文坐标");
  }
  const pageLabel = pageLabelFor(parent, match.pageIndex);
  match.pageLabel = pageLabel;
  let annotationKey = (annotation.annotationKey || "").trim();
  if (annotationKey) {
    const existing = (Zotero as any).Items.getByLibraryAndKey(
      attachment.libraryID,
      annotationKey,
    );
    if (!existing?.isAnnotation?.() || existing.parentID !== attachment.id) {
      throw new Error("指定的 Zotero PDF 批注不存在或不属于当前 PDF");
    }
  } else {
    annotationKey = (Zotero as any).DataObjectUtilities.generateKey();
  }
  const nativeSortIndex = [
    String(match.pageIndex).slice(0, 5).padStart(5, "0"),
    String(Math.max(0, Math.floor(match.offset || 0)))
      .slice(0, 6)
      .padStart(6, "0"),
    String(Math.max(0, Math.floor(match.top || 0)))
      .slice(0, 5)
      .padStart(5, "0"),
  ].join("|");
  return (Zotero.Annotations as any).saveFromJSON(attachment, {
    key: annotationKey,
    type: "highlight",
    text: annotation.selector.exact,
    comment: annotationComment(annotation),
    color: normalizeAnnotationColor(annotation.color),
    pageLabel,
    sortIndex: nativeSortIndex,
    position: {
      pageIndex: match.pageIndex,
      rects: match.rects,
      ...(match.nextPageRects ? { nextPageRects: match.nextPageRects } : {}),
    },
    tags: [{ name: "paper-bridge" }],
  });
}

class PingEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (
      requestHeader(request, "X-Paper-Bridge-Token") !==
      getOrCreatePairingToken()
    ) {
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    }
    return jsonResponse(200, {
      ok: true,
      name: config.addonName,
      version: pkg.version,
      paired: true,
    });
  }
}

class AnnotationEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });

    if (
      requestHeader(request, "X-Paper-Bridge-Token") !==
      getOrCreatePairingToken()
    ) {
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    }

    try {
      const annotation = parseBody(request);
      if (!annotation?.selector?.exact?.trim()) {
        return jsonResponse(400, { ok: false, error: "缺少英文原文锚点" });
      }
      if (/[\u3400-\u9fff]/.test(annotation.selector.exact)) {
        return jsonResponse(400, {
          ok: false,
          error: "定位锚点仍含中文，已阻止写入；请等待扩展完成中文到英文反查",
        });
      }

      const parentSelection = await findParentItem(annotation);
      if (!parentSelection) {
        return jsonResponse(404, {
          ok: false,
          error: "Zotero 中未找到 DOI 或标题相符的文献条目",
        });
      }

      const parent = parentSelection.item;

      const located = await findPDFMatch(parent, annotation.selector);
      if (!located.attachment) {
        return jsonResponse(200, {
          ok: true,
          itemKey: parent.key,
          itemMatchReason: parentSelection.reason,
          duplicateCandidates: parentSelection.candidateCount,
          match: located.match,
          nativePdfHighlightCreated: false,
          error: "该条目没有 PDF 附件，未创建批注",
        });
      }
      if (
        located.match.pageIndex === undefined ||
        !located.match.rects?.length
      ) {
        return jsonResponse(200, {
          ok: true,
          itemKey: parent.key,
          itemMatchReason: parentSelection.reason,
          duplicateCandidates: parentSelection.candidateCount,
          attachmentID: located.attachment.id,
          match: located.match,
          nativePdfHighlightCreated: false,
          error:
            "已取得英文原文，但未在当前 PDF 已读取的页面中找到唯一对应位置；可能存在版本、排版或读取页数限制，请尝试缩短选区。",
        });
      }
      const nativeAnnotation = await saveNativeHighlight(
        parent,
        located.attachment,
        annotation,
        located.match,
      );
      return jsonResponse(201, {
        ok: true,
        itemKey: parent.key,
        itemMatchReason: parentSelection.reason,
        duplicateCandidates: parentSelection.candidateCount,
        annotationKey: nativeAnnotation.key,
        attachmentID: located.attachment.id,
        match: located.match,
        nativePdfHighlightCreated: true,
      });
    } catch (error) {
      ztoolkit.log("Translate Bridge for Zotero request failed", error);
      return jsonResponse(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

class OpenAnnotationEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (
      requestHeader(request, "X-Paper-Bridge-Token") !==
      getOrCreatePairingToken()
    ) {
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    }

    try {
      const payload = parseOpenBody(request);
      const attachmentID = Number(payload.attachmentID);
      const annotationKey = String(payload.annotationKey || "").trim();
      if (
        !Number.isInteger(attachmentID) ||
        attachmentID <= 0 ||
        !annotationKey
      ) {
        return jsonResponse(400, {
          ok: false,
          error: "缺少 PDF 附件或批注定位信息",
        });
      }

      const attachment = await Zotero.Items.getAsync(attachmentID);
      if (!attachment?.isPDFAttachment?.()) {
        return jsonResponse(404, { ok: false, error: "对应 PDF 附件不存在" });
      }
      const annotation = (Zotero as any).Items.getByLibraryAndKey(
        attachment.libraryID,
        annotationKey,
      );
      if (
        !annotation?.isAnnotation?.() ||
        annotation.parentID !== attachment.id
      ) {
        return jsonResponse(404, {
          ok: false,
          error: "对应 PDF 高亮不存在或已被删除",
        });
      }

      await (Zotero.Reader as any).open(
        attachment.id,
        { annotationID: annotationKey },
        {},
      );
      (Zotero as any).getMainWindow?.()?.focus?.();
      return jsonResponse(200, {
        ok: true,
        attachmentID: attachment.id,
        annotationKey,
      });
    } catch (error) {
      ztoolkit.log("Translate Bridge for Zotero open request failed", error);
      return jsonResponse(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

class OpenDocumentEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (
      requestHeader(request, "X-Paper-Bridge-Token") !==
      getOrCreatePairingToken()
    ) {
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    }

    try {
      const payload = parseDocumentBody(request);
      const parentSelection = await findParentItem(payload);
      if (!parentSelection) {
        return jsonResponse(404, {
          ok: false,
          error: "Zotero 中未找到 DOI 或标题相符的文献条目",
        });
      }
      const attachment = firstPdfAttachment(parentSelection.item);
      if (!attachment) {
        return jsonResponse(404, {
          ok: false,
          error: "该文献条目没有 PDF 附件",
        });
      }
      await (Zotero.Reader as any).open(attachment.id);
      (Zotero as any).getMainWindow?.()?.focus?.();
      return jsonResponse(200, {
        ok: true,
        attachmentID: attachment.id,
        itemKey: parentSelection.item.key,
      });
    } catch (error) {
      ztoolkit.log("Translate Bridge for Zotero open document request failed", error);
      return jsonResponse(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

class OpenSelectionEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (
      requestHeader(request, "X-Paper-Bridge-Token") !==
      getOrCreatePairingToken()
    ) {
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    }

    try {
      const payload = parseBody(request);
      if (!payload.selector?.exact?.trim()) {
        return jsonResponse(400, { ok: false, error: "请先选择一段原文" });
      }
      const parentSelection = await findParentItem(payload);
      if (!parentSelection) {
        return jsonResponse(404, {
          ok: false,
          error: "Zotero 中未找到 DOI 或标题相符的文献条目",
        });
      }
      const located = await findPDFMatch(
        parentSelection.item,
        payload.selector,
      );
      if (!located.attachment) {
        return jsonResponse(404, {
          ok: false,
          error: "该文献条目没有 PDF 附件",
        });
      }
      if (located.match.pageIndex === undefined) {
        return jsonResponse(404, {
          ok: false,
          error: "未在 PDF 中定位到当前选中段落",
        });
      }
      await (Zotero.Reader as any).open(
        located.attachment.id,
        { pageIndex: located.match.pageIndex },
        {},
      );
      (Zotero as any).getMainWindow?.()?.focus?.();
      return jsonResponse(200, {
        ok: true,
        attachmentID: located.attachment.id,
        match: located.match,
      });
    } catch (error) {
      ztoolkit.log("Translate Bridge for Zotero open selection request failed", error);
      return jsonResponse(500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function registerBridgeServer() {
  const endpoints = (Zotero.Server as any).Endpoints;
  endpoints[PING_PATH] = PingEndpoint;
  endpoints[ANNOTATION_PATH] = AnnotationEndpoint;
  endpoints[OPEN_PATH] = OpenAnnotationEndpoint;
  endpoints[OPEN_DOCUMENT_PATH] = OpenDocumentEndpoint;
  endpoints[OPEN_SELECTION_PATH] = OpenSelectionEndpoint;
}

export function unregisterBridgeServer() {
  const endpoints = (Zotero.Server as any).Endpoints;
  delete endpoints[PING_PATH];
  delete endpoints[ANNOTATION_PATH];
  delete endpoints[OPEN_PATH];
  delete endpoints[OPEN_DOCUMENT_PATH];
  delete endpoints[OPEN_SELECTION_PATH];
}
