import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

// Pure mapping checks. Chrome DOM ownership, selection expansion, rendered
// previews and PDF coordinates must also be checked by the browser regressions.
// Every example except the reported CFH excerpt is deliberately constructed.
// To audit an unchanged baseline, set PAPERBRIDGE_CONTENT_SOURCE to its file.
const sourcePath = process.env.PAPERBRIDGE_CONTENT_SOURCE ||
  new URL("../packages/browser-extension/content.js", import.meta.url);
const source = await fs.readFile(sourcePath, "utf8");
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing harness boundaries: ${from}`);
  return source.slice(start, end);
};
const harnessSource =
  slice("  function englishSentenceSegments(", "  function preserveSentenceBoundaries(") +
  slice("  function normalizedReadableText(", "  function isPdfAnchorReady(") +
  slice("  function compactChinese(", "  async function fetchSourceParagraphs(") +
  slice("  function translatedMappingCandidates(", "  function updateDocumentLine(");

function harness(translations = {}) {
  const calls = [];
  const context = vm.createContext({
    Intl, setTimeout, clearTimeout,
    recoverOriginalParagraph: async anchor => anchor.originalParagraph,
    getTranslator: async () => ({ translate: async text => {
      calls.push(text);
      return translations[text] || "测试替身返回不匹配的文字，禁止依靠相似位置猜测";
    } }),
  });
  vm.runInContext(harnessSource, context);
  return { context, calls };
}

export const splitCases = [
  {
    name: "reported CFH relative-clause reorder",
    english: "Among the top upregulated genes, we found complement factor H (CFH), which is a key regulator of the alternative pathway of the complement system, and the cytokine interleukin-33 (IL-33).",
    chinese: [
      "在显著上调的基因中，我们发现了补体因子H (CFH) 和细胞因子白细胞介素-33 (IL-33)。",
      "CFH是补体系统旁路途径的关键调节因子。",
    ],
  },
  {
    name: "materials relative clause moved after main statement",
    english: "The polymer, which remains stable at 40 °C, retained 80% of its tensile strength after treatment.",
    chinese: ["处理后，该聚合物保留了80%的抗拉强度。", "这种聚合物在40 °C时保持稳定。"],
  },
  {
    name: "astronomy semicolon split without figure references",
    english: "The telescope detected 12 candidate planets; however, only 4 candidates had independent confirmation.",
    chinese: ["望远镜探测到了12颗候选行星。", "然而，只有4颗候选行星获得了独立确认。"],
  },
  {
    name: "computing three clauses including opening and middle",
    english: "Although the training set contained only 200 images, the classifier reached 92% accuracy, while the baseline reached 75% accuracy.",
    chinese: ["训练集仅包含200张图像。", "该分类器仍达到了92%的准确率。", "基线模型的准确率为75%。"],
  },
  {
    name: "ecology negated opening clause",
    english: "Irrigation did not increase seedling survival, but it increased root biomass and reduced soil temperature.",
    chinese: ["灌溉并未提高幼苗存活率。", "但它增加了根系生物量并降低了土壤温度。"],
  },
];

for (const item of splitCases) {
  test(`${item.name}: full translated source sentence keeps the exact original`, async () => {
    const { context, calls } = harness();
    const chinese = item.chinese.join("");
    const result = await context.mapTranslatedSelection({
      exact: chinese, paragraph: chinese, originalParagraph: item.english,
      capturedSentenceSource: item.english,
      sentenceDiagnostic: { sentenceAnchors: 1, reason: "captured" },
    });
    assert.equal(result.exact, item.english);
    assert.equal(result.translatedSelection, chinese);
    assert.equal(result.selectedLanguage, "en");
    assert.equal(calls.length, 0, "verified complete source sentence does not need a second translator");
  });
}

test("CFH main statement is discontinuous in the original and must not be invented as one quote", () => {
  const { context } = harness();
  const original = splitCases[0].english;
  const stitched = "Among the top upregulated genes, we found complement factor H (CFH), and the cytokine interleukin-33 (IL-33).";
  assert.equal(original.includes(stitched), false);
  assert.equal(context.translatedMappingCandidates(original).includes(stitched), false);
  assert.equal(context.englishSentenceSegments(original).length, 1);
});

const exactSource = "In the blinded experiment, IL-33 treatment increased endothelial cell proliferation by 25% after 16 weeks without changing the prespecified measurement procedure or the number of independently assessed samples.";
const exactTranslation = "在盲法实验中，IL-33处理在16周后使内皮细胞增殖增加了25%，而预先规定的测量程序和独立评估的样本数量均保持不变。";
const extraSource = "The instruments were calibrated before every measurement.";
const extraChinese = "每次测量前都对仪器进行了校准。";
const selectionAnchor = exact => ({
  exact,
  paragraph: exact + extraChinese,
  originalParagraph: exactSource + " " + extraSource,
  sentenceDiagnostic: { sentenceAnchors: 2, reason: "partial-sentence-boundary" },
});

test("a verified exact local translation remains usable", async () => {
  const { context } = harness({ [exactSource]: exactTranslation });
  const result = await context.mapTranslatedSelection(selectionAnchor(exactTranslation));
  assert.equal(result.exact, exactSource);
  assert.equal(result.translatedSelection, exactTranslation);
});

const contradictoryTranslations = [
  ["negation insertion", exactTranslation.replace("使内皮", "未使内皮")],
  ["percentage change", exactTranslation.replace("25%", "35%")],
  ["timepoint change", exactTranslation.replace("16周", "18周")],
  ["gene identifier change", exactTranslation.replace("IL-33", "IL-13")],
  ["decimal quantity change", exactTranslation.replace("25%", "2.5%")],
  ["numeric sign change", exactTranslation.replace("25%", "-25%")],
];
for (const [name, translatedSelection] of contradictoryTranslations) {
  test(`near-identical fallback must reject ${name}`, async () => {
    const { context } = harness({ [exactSource]: exactTranslation });
    assert.ok(context.bigramSimilarity(
      context.compactChinese(translatedSelection), context.compactChinese(exactTranslation),
    ) >= 0.95, "this is a high-similarity adversarial example, not an obviously unrelated sentence");
    await assert.rejects(
      context.mapTranslatedSelection(selectionAnchor(translatedSelection)),
      /可靠|核验|不一致|不对应|无法|拒绝|匹配/,
      "high character similarity cannot prove equivalent scientific meaning",
    );
  });
}

test("matching figure labels cannot certify opposite scientific meaning", async () => {
  const original = "IL-33 increased endothelial cell proliferation after treatment (Fig. 2a).";
  const translated = "IL-33处理后提高了内皮细胞增殖水平（图2a）。";
  const selected = "IL-33处理后没有提高内皮细胞增殖水平（图2a）。";
  const { context } = harness({ [original]: translated });
  await assert.rejects(context.mapTranslatedSelection({
    exact: selected, paragraph: selected + extraChinese,
    originalParagraph: original + " " + extraSource,
    sentenceDiagnostic: { sentenceAnchors: 2, reason: "partial-sentence-boundary" },
  }), /可靠|核验|不一致|不对应|无法|拒绝|匹配/);
});

test("incomplete Chinese selection cannot be admitted by a matching translator stub", async () => {
  const { context } = harness({ [exactSource]: "内皮细胞增殖" });
  await assert.rejects(context.mapTranslatedSelection(selectionAnchor("内皮细胞增殖")), /完整句子/);
});

test("duplicate equally translated source sentences remain ambiguous", async () => {
  const other = exactSource.replace("In the blinded experiment", "In the confirmatory experiment");
  const { context } = harness({ [exactSource]: exactTranslation, [other]: exactTranslation });
  await assert.rejects(context.mapTranslatedSelection({
    ...selectionAnchor(exactTranslation),
    originalParagraph: exactSource + " " + other,
  }), /可靠|核验|不一致|不对应|无法|拒绝|匹配/);
});

test("the same English sentence at two positions must not silently choose the first", async () => {
  const { context } = harness({ [exactSource]: exactTranslation });
  await assert.rejects(context.mapTranslatedSelection({
    ...selectionAnchor(exactTranslation),
    originalParagraph: exactSource + " " + extraSource + " " + exactSource,
  }), /可靠|核验|不一致|不对应|无法|拒绝|匹配|多|重复/);
});

for (const reason of [
  "invalid-sentence-fragment-groups",
  "sentence-cache-missing",
  "sentence-source-mismatch",
  "uncovered-selection-text",
  "unresolved-sentence-suffix",
  "translation-collapsed-sentences",
]) {
  test(`a translator must not bypass invalid captured structure: ${reason}`, async () => {
    const { context, calls } = harness({ [exactSource]: exactTranslation });
    await assert.rejects(context.mapTranslatedSelection({
      ...selectionAnchor(exactTranslation),
      sentenceDiagnostic: { sentenceAnchors: 2, reason },
    }), /可靠|核验|不一致|不对应|无法|拒绝|匹配|缓存|结构|完整|刷新|边界|识别/);
    assert.equal(calls.length, 0, "structural provenance failure must stop before the translator is consulted");
  });
}

// A diagnostic-only snapshot is useful before implementing the DOM behavior.
// It does not assert that refusing valid split sentences is acceptable.
if (process.env.PAPERBRIDGE_SPLIT_DIAGNOSTICS === "1") {
  for (const item of splitCases) {
    for (let begin = 0; begin < item.chinese.length; begin++) {
      for (let end = begin + 1; end <= item.chinese.length; end++) {
        if (begin === 0 && end === item.chinese.length) continue;
        const exact = item.chinese.slice(begin, end).join("");
        const { context } = harness({ [item.english]: item.chinese.join("") });
        let outcome;
        try {
          const result = await context.mapTranslatedSelection({
            exact, paragraph: item.chinese.join(""), originalParagraph: item.english,
            sentenceDiagnostic: { sentenceAnchors: 1, reason: "partial-sentence-boundary" },
          });
          outcome = { status: "mapped", exact: result.exact, mappingMethod: result.mappingMethod };
        } catch (error) { outcome = { status: "rejected", message: String(error.message) }; }
        console.log(JSON.stringify({ fixture: item.name, begin, end, ...outcome }));
      }
    }
  }
}
