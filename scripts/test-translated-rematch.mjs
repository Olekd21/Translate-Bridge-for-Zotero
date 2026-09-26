import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await fs.readFile(
  "packages/browser-extension/content.js",
  "utf8",
);
const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
function harness(translations = {}) {
  const context = vm.createContext({
    Intl,
    setTimeout,
    clearTimeout,
    recoverOriginalParagraph: async (a) => a.originalParagraph,
    getTranslator: async () => ({
      translate: async (text) => translations[text] || "完全不同的内容不应定位",
    }),
  });
  vm.runInContext(
    slice(
      "  function normalizedReadableText(",
      "  function isPdfAnchorReady(",
    ) +
      slice(
        "  function compactChinese(",
        "  async function fetchSourceParagraphs(",
      ) +
      slice(
        "  function translatedMappingCandidates(",
        "  function updateDocumentLine(",
      ),
    context,
  );
  return context;
}
const original =
  "The sutures lost 75% of the original tensile strength at approximately four weeks.";
const zh = "缝线在约4周时损失了75%的初始抗拉强度。";

test("entire captured paragraph maps without a translation API", async () => {
  const h = harness();
  const result = await h.mapTranslatedSelection({
    exact: zh,
    paragraph: zh,
    originalParagraph: original,
  });
  assert.equal(result.exact, original);
  assert.equal(result.mappingMethod, "captured-whole-paragraph");
});
test("more than half of a paragraph must not silently expand to the whole paragraph", () => {
  const h = harness();
  assert.equal(
    h.fastPositionMapping(
      { exact: zh, paragraph: zh + "另外进行了对照实验。" },
      original,
    ),
    null,
  );
});
test("sentence counts and relative order alone must not select English", () => {
  const h = harness();
  assert.equal(
    h.fastPositionMapping(
      {
        exact: "对照组没有变化。",
        paragraph: "我们进行了实验。对照组没有变化。",
      },
      "Controls were unchanged. We performed the experiment.",
    ),
    null,
  );
});
test("short sentence is recovered by verified local translation", async () => {
  const paragraph =
    original +
    " The aortic recovery was assessed at multiple postoperative time points.";
  const h = harness({ [original]: zh });
  const result = await h.mapTranslatedSelection({
    exact: zh,
    paragraph: zh + "在多个时间点评估主动脉恢复情况。",
    originalParagraph: paragraph,
  });
  assert.equal(result.exact, original);
});
test("equally plausible English candidates are rejected", async () => {
  const other =
    "The control sutures lost 75% of their original tensile strength at four weeks.";
  const h = harness({ [original]: zh, [other]: zh });
  await assert.rejects(
    h.mapTranslatedSelection({
      exact: zh,
      paragraph: zh + "比较不同组。",
      originalParagraph: original + " " + other,
    }),
    /可靠/,
  );
});
test("low similarity cannot enable synchronization", async () => {
  const h = harness();
  await assert.rejects(
    h.mapTranslatedSelection({
      exact: zh,
      paragraph: zh + "其他发现。",
      originalParagraph: original,
    }),
    /可靠/,
  );
});
test("cross-block mapping fails closed if any selected text is unaccounted for", async () => {
  const h = harness();
  await assert.rejects(
    h.mapTranslatedSelection({
      exact: zh + "遗漏文字",
      parts: [{ exact: zh, paragraph: zh, originalParagraph: original }],
    }),
    /未识别/,
  );
});
test("cross-block mapping never returns partially recovered English", async () => {
  const h = harness();
  await assert.rejects(
    h.mapTranslatedSelection({
      exact: zh + "其他句子。",
      parts: [
        { exact: zh, paragraph: zh, originalParagraph: original },
        {
          exact: "其他句子。",
          paragraph: "其他句子。还有内容。",
          originalParagraph: original,
        },
      ],
    }),
    /可靠/,
  );
});
