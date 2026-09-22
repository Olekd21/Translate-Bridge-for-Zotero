import fs from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

export async function extractPdf(pdfPath) {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  const document = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = "";
    const spans = [];

    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      const start = text.length;
      text += item.str;
      const end = text.length;
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      spans.push({
        start,
        end,
        text: item.str,
        rect: [transform[4], transform[5], transform[4] + (item.width || 0), transform[5] + (item.height || Math.abs(transform[3]) || 0)],
      });
      text += item.hasEOL ? "\n" : " ";
    }

    pages.push({ pageIndex: pageNumber - 1, text, spans });
  }

  return {
    pages,
    text: pages.map((page) => page.text).join("\n"),
    pageCharacterCounts: pages.map((page) => page.text.length + 1),
  };
}

