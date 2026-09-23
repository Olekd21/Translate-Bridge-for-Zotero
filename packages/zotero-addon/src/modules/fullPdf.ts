import { PDFDocument } from "pdf-lib";
import type { RecognizerData } from "./pdfGeometry";
import { withDeadline } from "./deadline";

export type PdfReadDiagnostics = Record<string, number | boolean>;
const activeWorkers = new Set<any>();

// Use Zotero's own implementation, but not its shared background-task queue.
// Only the private worker created here may be terminated by this add-on.
export function pdfWorkerProtocol(nativeWorker: any): string | null {
  const implementation = String(nativeWorker?.getRecognizerData || "");
  return /["']pdf\.getRecognizerData["']/.test(implementation)
    ? "pdf.getRecognizerData"
    : /["']getRecognizerData["']/.test(implementation)
      ? "getRecognizerData"
      : null;
}

export function createPdfRecognizer(nativeWorker: any) {
  const action = pdfWorkerProtocol(nativeWorker);
  if (!action || !nativeWorker?.constructor) {
    throw new Error("当前 Zotero 的 PDF 接口尚不兼容，请反馈 Zotero 版本");
  }
  const worker = new nativeWorker.constructor();
  if (
    worker === nativeWorker ||
    typeof worker._enqueue !== "function" ||
    typeof worker._query !== "function"
  ) {
    throw new Error("当前 Zotero 不支持独立 PDF 读取，请反馈 Zotero 版本");
  }
  activeWorkers.add(worker);
  let closed = false;
  return {
    async recognize(bytes: Uint8Array): Promise<RecognizerData> {
      if (closed) throw new Error("PDF 读取已结束，请重新定位");
      const buf = new Uint8Array(bytes).buffer;
      return withDeadline(
        worker._enqueue(() => worker._query(action, { buf }, [buf]), true),
        20000,
        "PDF 单批页面读取超过 20 秒，已停止；请重试或检查 PDF 文件",
      );
    },
    close() {
      closed = true;
      worker._worker?.terminate();
      activeWorkers.delete(worker);
    },
  };
}

// Zotero's metadata recognizer reads at most five pages. Feed it read-only
// in-memory page groups, then restore the original page order. Never save a
// partial extraction or replace the user's PDF with one of these groups.
export async function extractFullPdf(
  bytes: Uint8Array,
  recognize: (bytes: Uint8Array) => Promise<RecognizerData>,
): Promise<RecognizerData> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const totalPages = source.getPageCount();
  if (!totalPages) throw new Error("PDF 没有可读取的页面");
  const pages: unknown[] = [];
  for (let start = 0; start < totalPages; start += 5) {
    const count = Math.min(5, totalPages - start);
    const part = await PDFDocument.create();
    const indices = Array.from({ length: count }, (_, i) => start + i);
    const copied = await part.copyPages(source, indices);
    copied.forEach((page) => part.addPage(page));
    const result = await recognize(
      await part.save({ useObjectStreams: false }),
    );
    if (result.pages?.length !== count || result.totalPages !== count) {
      throw new Error(
        `PDF 页面读取不完整（第 ${start + 1}–${start + count} 页），未创建批注`,
      );
    }
    pages.push(...result.pages);
  }
  return { totalPages, pages };
}

export class PdfGeometryCache {
  private entries = new Map<string, Promise<RecognizerData>>();

  has(key: string) {
    return this.entries.has(key);
  }

  get(key: string, load: () => Promise<RecognizerData>) {
    const existing = this.entries.get(key);
    if (existing) return existing;
    const pending = load().catch((error) => {
      if (this.entries.get(key) === pending) this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, pending);
    while (this.entries.size > 2) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    return pending;
  }

  clear() {
    this.entries.clear();
  }
}

const cache = new PdfGeometryCache();
export function clearPdfCache() {
  cache.clear();
  for (const worker of activeWorkers) worker._worker?.terminate();
  activeWorkers.clear();
}

export async function readFullPdfGeometry(
  attachment: any,
  diagnostics: PdfReadDiagnostics = {},
): Promise<RecognizerData> {
  const started = Date.now();
  const path = await attachment.getFilePathAsync();
  if (!path)
    throw new Error("PDF 文件未下载到本机，请先在 Zotero 中打开并下载附件");
  const io = ztoolkit.getGlobal("IOUtils");
  const before = await io.stat(path);
  const key = `${attachment.id}:${path}:${before.size}:${before.lastModified}`;
  diagnostics.cacheHit = cache.has(key);
  const result = await cache.get(key, async () => {
    const recognizer = createPdfRecognizer(Zotero.PDFWorker);
    try {
      return await withDeadline(
        (async () => {
          const data = await extractFullPdf(
            new Uint8Array(await io.read(path)),
            (bytes) => recognizer.recognize(bytes),
          );
          const after = await io.stat(path);
          if (
            before.size !== after.size ||
            before.lastModified !== after.lastModified
          ) {
            throw new Error("读取期间 PDF 文件发生变化，请重新同步");
          }
          return data;
        })(),
        90000,
        "PDF 全文读取超过 90 秒，已停止；请检查文件大小或重试",
      );
    } finally {
      recognizer.close();
    }
  });
  diagnostics.pdfReadMs = Date.now() - started;
  diagnostics.pages = result.totalPages || 0;
  return result;
}
