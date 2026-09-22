import { PDFDocument } from "pdf-lib";
import type { RecognizerData } from "./pdfGeometry";

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
}

export async function readFullPdfGeometry(
  attachment: any,
): Promise<RecognizerData> {
  const path = await attachment.getFilePathAsync();
  if (!path)
    throw new Error("PDF 文件未下载到本机，请先在 Zotero 中打开并下载附件");
  const io = ztoolkit.getGlobal("IOUtils");
  const before = await io.stat(path);
  const key = `${attachment.id}:${path}:${before.size}:${before.lastModified}`;
  return cache.get(key, async () => {
    const worker = Zotero.PDFWorker as any;
    if (
      typeof worker._enqueue !== "function" ||
      typeof worker._query !== "function"
    ) {
      throw new Error(
        "当前 Zotero 版本不支持全文坐标读取，请更新 Zotero 后重试",
      );
    }
    const data = await extractFullPdf(
      new Uint8Array(await io.read(path)),
      (bytes) => {
        const buf = new Uint8Array(bytes).buffer;
        return worker._enqueue(
          () => worker._query("getRecognizerData", { buf }, [buf]),
          true,
        );
      },
    );
    const after = await io.stat(path);
    if (
      before.size !== after.size ||
      before.lastModified !== after.lastModified
    ) {
      throw new Error("读取期间 PDF 文件发生变化，请重新同步");
    }
    return data;
  });
}
