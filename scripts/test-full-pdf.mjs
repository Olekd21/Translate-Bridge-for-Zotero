import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "../packages/zotero-addon/node_modules/esbuild/lib/main.js";
import pdfLib from "../packages/zotero-addon/node_modules/pdf-lib/cjs/index.js";
const { PDFDocument, degrees } = pdfLib;
const bundle = await build({
  entryPoints: ["packages/zotero-addon/src/modules/fullPdf.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { extractFullPdf, PdfGeometryCache, readFullPdfGeometry, clearPdfCache } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
  );

async function fixture(count = 13) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([600 + i, 800]);
    page.setCropBox(10, 20, 550, 740);
    if (i === 12) page.setRotation(degrees(90));
    page.drawText(`Page ${i + 1} contains distinctive searchable text.`);
  }
  return doc.save();
}

test("reads every page, restores original order, preserves crop and rotation, never changes source", async () => {
  const bytes = await fixture();
  const before = bytes.slice();
  const sizes = [];
  const data = await extractFullPdf(bytes, async (part) => {
    const doc = await PDFDocument.load(part);
    sizes.push(doc.getPageCount());
    return {
      totalPages: doc.getPageCount(),
      pages: doc.getPages().map((page) => ({
        width: page.getWidth(),
        crop: page.getCropBox(),
        rotation: page.getRotation().angle,
      })),
    };
  });
  assert.deepEqual(sizes, [5, 5, 3]);
  assert.equal(data.totalPages, 13);
  assert.deepEqual(
    data.pages.map((p) => p.width),
    Array.from({ length: 13 }, (_, i) => 600 + i),
  );
  assert.deepEqual(data.pages[12].crop, {
    x: 10,
    y: 20,
    width: 550,
    height: 740,
  });
  assert.equal(data.pages[12].rotation, 90);
  assert.deepEqual(bytes, before);
});

test("short final batch and failures never return silently truncated coverage", async () => {
  let calls = 0;
  await assert.rejects(
    extractFullPdf(await fixture(), async () => {
      calls++;
      return { totalPages: 5, pages: Array(calls === 2 ? 4 : 5).fill([]) };
    }),
    /第 6–10 页/,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    extractFullPdf(new Uint8Array([1, 2, 3]), async () => {
      assert.fail("Invalid PDF must not reach native recognizer");
    }),
  );
});

test("single-page PDF is read once", async () => {
  let count = 0;
  const result = await extractFullPdf(await fixture(1), async (bytes) => {
    count++;
    const doc = await PDFDocument.load(bytes);
    return { totalPages: doc.getPageCount(), pages: [[]] };
  });
  assert.equal(count, 1);
  assert.equal(result.pages.length, 1);
});

test("cache shares in-flight work, retries failed reads, and invalidates changed file keys", async () => {
  const cache = new PdfGeometryCache();
  let calls = 0;
  const load = async () => {
    calls++;
    return { totalPages: 1, pages: [[]] };
  };
  const [a, b] = await Promise.all([
    cache.get("pdf:mtime1", load),
    cache.get("pdf:mtime1", load),
  ]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  await cache.get("pdf:mtime2", load);
  assert.equal(calls, 2);
  await assert.rejects(
    cache.get("bad", async () => {
      throw new Error("read failed");
    }),
  );
  await cache.get("bad", load);
  assert.equal(calls, 3);
  await cache.get("pdf:mtime1", load);
  assert.equal(calls, 4);
  cache.clear();
  await cache.get("pdf:mtime1", load);
  assert.equal(calls, 5);
});

test("Zotero adapter checks file changes and native worker capability", async () => {
  const bytes = await fixture(1);
  let stats = 0;
  globalThis.ztoolkit = {
    getGlobal: () => ({
      stat: async () => ({ size: bytes.length, lastModified: ++stats }),
      read: async () => bytes,
    }),
  };
  globalThis.Zotero = {
    PDFWorker: {
      _enqueue: async (callback) => callback(),
      _query: async () => ({ totalPages: 1, pages: [[]] }),
    },
  };
  const attachment = { id: 1, getFilePathAsync: async () => "fixture.pdf" };
  await assert.rejects(readFullPdfGeometry(attachment), /文件发生变化/);
  clearPdfCache();
  globalThis.Zotero.PDFWorker = {};
  await assert.rejects(readFullPdfGeometry(attachment), /不支持全文/);
  await assert.rejects(
    readFullPdfGeometry({ getFilePathAsync: async () => false }),
    /未下载/,
  );
  delete globalThis.Zotero;
  delete globalThis.ztoolkit;
});
