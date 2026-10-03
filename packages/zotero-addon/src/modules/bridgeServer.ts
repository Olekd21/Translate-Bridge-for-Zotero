import pkg from "../../package.json";
import { type TextQuoteSelector } from "./textMatcher";
import { locateQuoteGeometry, type GeometryMatch } from "./pdfGeometry";
import {
  readFullPdfGeometry,
  clearPdfCache,
  pdfWorkerProtocol,
  type PdfReadDiagnostics,
} from "./fullPdf";
import { withDeadline } from "./deadline";

const { config } = pkg;
const PING_PATH = "/paperbridge/ping";
const ANNOTATION_PATH = "/paperbridge/annotations";
const LIST_ANNOTATIONS_PATH = "/paperbridge/list-annotations";
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
): Promise<{
  attachment?: any;
  match: GeometryMatch;
  error?: string;
  diagnostics?: PdfReadDiagnostics;
}> {
  const attachment = firstPdfAttachment(parent);

  if (!attachment) {
    return { match: { status: "not-found", occurrences: 0 } };
  }

  try {
    const diagnostics: PdfReadDiagnostics = {};
    const result = await withDeadline(
      readFullPdfGeometry(attachment, diagnostics),
      95000,
      "PDF 文件读取超时，请确认附件已完整下载到本机",
    );
    const started = Date.now();
    const match = locateQuoteGeometry(result, selector);
    diagnostics.matchMs = Date.now() - started;
    return {
      attachment,
      match,
      diagnostics,
    };
  } catch (error) {
    ztoolkit.log(
      "Translate Bridge for Zotero PDF geometry extraction failed",
      error,
    );
    return {
      attachment,
      match: { status: "not-found", occurrences: 0 },
      error: `PDF 全文读取失败，未创建批注：${error instanceof Error ? error.message : String(error)}`,
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
): Promise<any> {
  if (match.additionalPages?.length) {
    // Zotero's nextPageRects always means the immediately following page.
    // saveFromJSON starts its own transaction. Do not wrap it in another
    // transaction (that waits for the outer transaction and deadlocks).
    if (annotation.annotationKey) throw new Error("跨图页批注请作为新批注保存");
    const saved: any[] = [];
    try {
      const { additionalPages = [], ...first } = match;
      const created = await saveNativeHighlight(parent, attachment, annotation, first);
      saved.push(created);
      for (const part of additionalPages) {
        saved.push(await saveNativeHighlight(parent, attachment,
          { ...annotation, annotationKey: undefined },
          { status: "unique", occurrences: 1, ...part }));
      }
      match.pageLabel = [first.pageIndex!, ...additionalPages.map((part) => part.pageIndex)]
        .map((index) => pageLabelFor(parent, index)).join("、");
      return created;
    } catch (error) {
      for (const item of saved.reverse()) await item.eraseTx();
      throw error;
    }
  }
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
      zoteroVersion: Zotero.version,
      paired: true,
      capabilities: {
        fullDocumentGeometry: true,
        pdfProtocol: pdfWorkerProtocol(Zotero.PDFWorker),
        isolatedPdfWorker: true,
      },
    });
  }
}

class ListAnnotationsEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;
  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });
    if (requestHeader(request, "X-Paper-Bridge-Token") !== getOrCreatePairingToken())
      return jsonResponse(401, { ok: false, error: "配对码不正确" });
    try {
      const payload = parseDocumentBody(request);
      const selection = await findParentItem(payload);
      if (!selection) return jsonResponse(404, { ok: false, error: "Zotero 中未找到这篇文章" });
      const parent = selection.item;
      const doi = normalizeDOI(payload.document?.doi);
      // Reading annotations must never fall back to a different paper by title.
      if (doi ? normalizeDOI(parent.getField("DOI")) !== doi :
          String(parent.getField("title")).trim().toLowerCase() !== String(payload.document?.title || "").trim().toLowerCase())
        return jsonResponse(409, { ok: false, error: "文章身份不能可靠确认，未读取批注" });
      const annotations = [];
      for (const id of parent.getAttachments()) {
        const attachment = Zotero.Items.get(id);
        if (!attachment?.isPDFAttachment?.() || attachment.deleted) continue;
        for (const annotation of attachment.getAnnotations()) {
          if (annotation.deleted) continue;
          annotations.push({
            annotationKey: annotation.key, attachmentID: attachment.id,
            type: annotation.annotationType, text: annotation.annotationText || "",
            comment: annotation.annotationComment || "", color: annotation.annotationColor,
            pageLabel: annotation.annotationPageLabel || "",
          });
        }
      }
      return jsonResponse(200, { ok: true, annotations, candidateCount: selection.candidateCount });
    } catch (error) {
      return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const importJobs = new Map<number, {state:string; error?:string}>();
let importWork: Promise<unknown> = Promise.resolve();
class ImportDocumentEndpoint {
  supportedMethods=["POST","OPTIONS"];
  supportedDataTypes=["application/json"];
  permitBookmarklet=false;
  async init(request:EndpointRequest) {
    if(request.method==="OPTIONS")return jsonResponse(200,{ok:true});
    if(requestHeader(request,"X-Paper-Bridge-Token")!==getOrCreatePairingToken())return jsonResponse(401,{ok:false,error:"配对码不正确"});
    const action=async()=>{
      try {
        const body=(typeof request.data==="string"?JSON.parse(request.data):request.data) as any;
        if(body?.action==='status')return jsonResponse(200,{ok:true,...(importJobs.get(body.itemID)||{state:'unknown'})});
        const doc=body?.document;
        if(!doc || typeof doc.title!=='string' || !doc.title.trim() || doc.title.length>2000 || !/^https?:\/\//i.test(doc.url||''))
          return jsonResponse(400,{ok:false,error:"缺少论文标题或有效网页地址"});
        const libraryID=Zotero.Libraries.userLibraryID;
        const doi=normalizeDOI(doc.doi);
        const search=new Zotero.Search();search.addCondition("libraryID","is",String(libraryID));
        search.addCondition(doi?'DOI':'url','is',doi||doc.url);
        const existing=(await search.search()).map((id:number)=>Zotero.Items.get(id)).find((item:any)=>item?.isRegularItem()&&!item.deleted);
        const item=existing||new Zotero.Item('journalArticle');
        if(!existing) {
          item.libraryID=libraryID;item.setField('title',doc.title.trim());item.setField('url',doc.url);
          if(doi)item.setField('DOI',doi);
          for(const field of ['publicationTitle','date','volume','issue','pages','ISSN'])
            if(typeof doc[field]==='string' && doc[field].length<=1000)item.setField(field,doc[field]);
          item.setCreators((Array.isArray(doc.authors)?doc.authors:[]).slice(0,100).filter((name:any)=>typeof name==='string'&&name.trim()).map((name:string)=>({creatorType:'author',fieldMode:1,lastName:name.trim()})));
          await item.saveTx();
        }
        const hasPDF=item.getAttachments().some((id:number)=>Zotero.Items.get(id)?.isPDFAttachment());
        if(hasPDF)importJobs.set(item.id,{state:'pdf-saved'});
        else if(!importJobs.has(item.id)) {
          importJobs.set(item.id,{state:'fetching-pdf'});
          void (async()=>{
            try {
              const pdf=await (Zotero.Attachments as any).addAvailableFile(item);
              importJobs.set(item.id,{state:pdf?.isPDFAttachment?.()?'pdf-saved':'no-pdf'});
            }catch(error){importJobs.set(item.id,{state:'no-pdf',error:error instanceof Error?error.message:String(error)});}
          })();
        }
        return jsonResponse(200,{ok:true,itemID:item.id,existing:Boolean(existing),...importJobs.get(item.id)});
      }catch(error){return jsonResponse(500,{ok:false,error:error instanceof Error?error.message:String(error)});}
    };
    const result=importWork.then(action,action);importWork=result.catch(()=>{});return result;
  }
}

const webSelections = new Map<string, {expires:number; exact:string; doi:string; url:string}>();
export function queueWebSelection(exact:string, doi:string, url:string) {
  const now=Date.now();
  for(const [key,value] of webSelections) if(value.expires<now) webSelections.delete(key);
  while(webSelections.size>=50) webSelections.delete(webSelections.keys().next().value!);
  const ticket=Zotero.Utilities.randomString(32);
  webSelections.set(ticket,{expires:now+10*60*1000,exact:exact.slice(0,20000),doi:normalizeDOI(doi),url:url.split("#")[0]});
  return ticket;
}
class WebSelectionEndpoint {
  supportedMethods=["POST","OPTIONS"];
  supportedDataTypes=["application/json"];
  permitBookmarklet=false;
  async init(request:EndpointRequest) {
    if(request.method==="OPTIONS")return jsonResponse(200,{ok:true});
    if(requestHeader(request,"X-Paper-Bridge-Token")!==getOrCreatePairingToken())return jsonResponse(401,{ok:false,error:"配对码不正确"});
    const body=(typeof request.data==="string"?JSON.parse(request.data):request.data) as any;
    const entry=webSelections.get(body?.ticket);
    if(!entry||entry.expires<Date.now())return jsonResponse(404,{ok:false,error:"网页定位请求已过期，请从PDF重新点击网页阅读"});
    if(entry.doi ? normalizeDOI(body.doi)!==entry.doi : String(body.url||"").split("#")[0]!==entry.url)
      return jsonResponse(409,{ok:false,error:"当前网页与PDF文献身份不符，未返回选中文字"});
    return jsonResponse(200,{ok:true,exact:entry.exact});
  }
}

class MutateAnnotationEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;
  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200, {ok:true});
    if (requestHeader(request,"X-Paper-Bridge-Token") !== getOrCreatePairingToken())
      return jsonResponse(401,{ok:false,error:"配对码不正确"});
    try {
      const body = (typeof request.data === "string" ? JSON.parse(request.data) : request.data) as any;
      if (!body || !["edit","delete"].includes(body.action) || !Number.isInteger(body.attachmentID) ||
          typeof body.annotationKey !== "string" || typeof body.expectedComment !== "string" ||
          (body.action === "edit" && (typeof body.comment !== "string" || body.comment.length > 50000)))
        return jsonResponse(400,{ok:false,error:"批注修改参数无效"});
      const attachment = Zotero.Items.get(body.attachmentID);
      if (!attachment?.isPDFAttachment?.() || attachment.deleted)
        return jsonResponse(404,{ok:false,error:"PDF附件不存在"});
      const annotation = attachment.getAnnotations().find((item:any)=>item.key===body.annotationKey && !item.deleted);
      if (!annotation) return jsonResponse(404,{ok:false,error:"批注不存在或已删除"});
      if (!(Zotero.Libraries.get(attachment.libraryID) as any).editable || (annotation as any).annotationIsExternal)
        return jsonResponse(403,{ok:false,error:"此批注不能编辑，请检查文库权限或嵌入PDF的批注"});
      let conflict = false;
      await Zotero.DB.executeTransaction(async () => {
        if ((annotation.annotationComment || "") !== body.expectedComment) {conflict=true;return;}
        if (body.action === "delete") annotation.deleted = true;
        else {
          // Accept plain text only; never execute or insert submitted HTML.
          const escaped = body.comment.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          annotation.annotationComment = escaped.split(/\r?\n/).map((line:string)=>`<p>${line || "<br>"}</p>`).join("");
        }
        await annotation.save();
      });
      if (conflict) return jsonResponse(409,{ok:false,error:"批注已在Zotero中改变，请刷新后再编辑"});
      return jsonResponse(200,{ok:true,annotationKey:annotation.key});
    } catch(error) {return jsonResponse(500,{ok:false,error:error instanceof Error?error.message:String(error)});}
  }
}

class ArticleNotesEndpoint {
  supportedMethods = ["POST", "OPTIONS"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;
  async init(request: EndpointRequest) {
    if (request.method === "OPTIONS") return jsonResponse(200,{ok:true});
    if (requestHeader(request,"X-Paper-Bridge-Token") !== getOrCreatePairingToken())
      return jsonResponse(401,{ok:false,error:"配对码不正确"});
    try {
      const body = (typeof request.data === "string" ? JSON.parse(request.data) : request.data) as any;
      if (!body || !["list","save"].includes(body.action)) return jsonResponse(400,{ok:false,error:"笔记请求无效"});
      const match = await findParentItem(body);
      if (!match || match.item.deleted || !match.item.isRegularItem()) return jsonResponse(404,{ok:false,error:"请先将这篇文章添加到 Zotero"});
      const parent=match.item, doi=normalizeDOI(body.document?.doi);
      if (doi ? normalizeDOI(parent.getField("DOI"))!==doi : String(parent.getField("url"))!==body.document?.url)
        return jsonResponse(409,{ok:false,error:"文章身份不一致，未操作笔记"});
      if (match.candidateCount>1 && match.reason!=="selected-item")
        return jsonResponse(409,{ok:false,error:"存在重复文献，请在 Zotero 中选中要保存笔记的条目"});
      const identity={parentID:parent.id,libraryID:parent.libraryID,parentKey:parent.key};
      const serialize=(note:any)=>({key:note.key,html:note.getNote(),title:note.getNoteTitle(),dateModified:note.dateModified});
      if (body.action==="list") return jsonResponse(200,{ok:true,...identity,notes:parent.getNotes().map((id:number)=>Zotero.Items.get(id)).filter((n:any)=>n?.isNote()&&!n.deleted).map(serialize)});
      if (body.parentID!==parent.id || body.libraryID!==parent.libraryID || body.parentKey!==parent.key)
        return jsonResponse(409,{ok:false,error:"文献或文库已改变，请重新读取文章笔记；草稿仍保留"});
      if (!(Zotero.Libraries.get(parent.libraryID) as any).editable) return jsonResponse(403,{ok:false,error:"此文库不可编辑"});
      if (typeof body.title!=="string" || !body.title.trim() || body.title.length>300 || typeof body.text!=="string" || body.text.length>200000)
        return jsonResponse(400,{ok:false,error:"请填写笔记标题，正文不能超过20万字"});
      let note:any, conflict=false;
      await Zotero.DB.executeTransaction(async()=>{
        if (body.key) {
          note=parent.getNotes().map((id:number)=>Zotero.Items.get(id)).find((n:any)=>n.key===body.key && !n.deleted);
          if (!note || typeof body.expectedHTML!=="string" || note.getNote()!==body.expectedHTML) {conflict=true;return;}
        } else {note=new Zotero.Item("note");note.libraryID=parent.libraryID;note.parentID=parent.id;}
        const escape=(text:string)=>text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        note.setNote(`<div data-schema-version="9"><h1>${escape(body.title.trim())}</h1>${body.text.split(/\r?\n/).map((line:string)=>`<p>${escape(line)||"<br>"}</p>`).join("")}</div>`);
        await note.save();
      });
      if(conflict)return jsonResponse(409,{ok:false,error:"笔记已在 Zotero 中修改或删除，请重新读取后核对；草稿仍保留"});
      return jsonResponse(200,{ok:true,...identity,note:serialize(note)});
    } catch(error){return jsonResponse(500,{ok:false,error:error instanceof Error?error.message:String(error)});}
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
        return jsonResponse(404, {
          ok: false,
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
        return jsonResponse(422, {
          ok: false,
          itemKey: parent.key,
          itemMatchReason: parentSelection.reason,
          duplicateCandidates: parentSelection.candidateCount,
          attachmentID: located.attachment.id,
          match: located.match,
          nativePdfHighlightCreated: false,
          error:
            located.error ||
            (located.match.status === "ambiguous"
              ? "PDF 全文中存在多处相似原文，未创建批注；请选择带有更多上下文的完整句子。"
              : "已检索 PDF 全文，未找到对应文字；请确认网页与 PDF 是同一版本，且 PDF 文字可以选择。"),
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
        annotationCount: 1 + (located.match.additionalPages?.length || 0),
        diagnostics: located.diagnostics,
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

      await withDeadline(
        (Zotero.Reader as any).open(
          attachment.id,
          { annotationID: annotationKey },
          {},
        ),
        15000,
        "PDF 打开等待超过 15 秒，请在 Zotero 中确认阅读器是否已打开",
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
      await withDeadline(
        (Zotero.Reader as any).open(attachment.id),
        15000,
        "PDF 打开等待超过 15 秒，请在 Zotero 中确认阅读器是否已打开",
      );
      (Zotero as any).getMainWindow?.()?.focus?.();
      return jsonResponse(200, {
        ok: true,
        attachmentID: attachment.id,
        itemKey: parentSelection.item.key,
      });
    } catch (error) {
      ztoolkit.log(
        "Translate Bridge for Zotero open document request failed",
        error,
      );
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
          error:
            located.error ||
            (located.match.status === "ambiguous"
              ? "PDF 全文中存在多处相似原文，无法唯一定位；请选择带有更多上下文的完整句子。"
              : "已检索 PDF 全文，未找到对应文字；请确认网页与 PDF 版本一致，且 PDF 文字可以选择。"),
        });
      }
      const openStarted = Date.now();
      await withDeadline(
        (Zotero.Reader as any).open(
          located.attachment.id,
          { pageIndex: located.match.pageIndex },
          {},
        ),
        15000,
        "已完成文字定位，但 PDF 阅读器超过 15 秒未返回；请在 Zotero 中确认打开状态",
      );
      (Zotero as any).getMainWindow?.()?.focus?.();
      return jsonResponse(200, {
        ok: true,
        attachmentID: located.attachment.id,
        match: located.match,
        diagnostics: {
          ...located.diagnostics,
          openMs: Date.now() - openStarted,
        },
      });
    } catch (error) {
      ztoolkit.log(
        "Translate Bridge for Zotero open selection request failed",
        error,
      );
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
  endpoints[LIST_ANNOTATIONS_PATH] = ListAnnotationsEndpoint;
  endpoints["/paperbridge/article-notes"] = ArticleNotesEndpoint;
  endpoints["/paperbridge/mutate-annotation"] = MutateAnnotationEndpoint;
  endpoints["/paperbridge/web-selection"] = WebSelectionEndpoint;
  endpoints["/paperbridge/import-document"] = ImportDocumentEndpoint;
  endpoints[OPEN_PATH] = OpenAnnotationEndpoint;
  endpoints[OPEN_DOCUMENT_PATH] = OpenDocumentEndpoint;
  endpoints[OPEN_SELECTION_PATH] = OpenSelectionEndpoint;
}

export function unregisterBridgeServer() {
  clearPdfCache();
  const endpoints = (Zotero.Server as any).Endpoints;
  delete endpoints[PING_PATH];
  delete endpoints[ANNOTATION_PATH];
  delete endpoints[LIST_ANNOTATIONS_PATH];
  delete endpoints["/paperbridge/article-notes"];
  delete endpoints["/paperbridge/mutate-annotation"];
  delete endpoints["/paperbridge/web-selection"];
  delete endpoints["/paperbridge/import-document"];
  webSelections.clear();
  delete endpoints[OPEN_PATH];
  delete endpoints[OPEN_DOCUMENT_PATH];
  delete endpoints[OPEN_SELECTION_PATH];
}
