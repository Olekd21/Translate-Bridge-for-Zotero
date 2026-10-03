import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await fs.readFile(new URL("../packages/browser-extension/content.js", import.meta.url), "utf8");
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `missing harness boundary: ${from}`);
  return source.slice(start, end);
};
const h = vm.createContext({
  Intl, URL, setTimeout, clearTimeout,
  location: { href: "https://example.org/article" },
  Node: { TEXT_NODE: 3 }, NodeFilter: { SHOW_TEXT: 4 },
  document: { createTreeWalker: () => ({ nextNode: () => false }), getElementById: () => null },
  recoverOriginalParagraph: async anchor => anchor.originalParagraph,
  getTranslator: async () => { throw Error("coverage failure must stop before translation"); },
});
vm.runInContext(
  slice("  function normalizedReadableText(", "  function isPdfAnchorReady(") +
  slice("  function compactChinese(", "  async function fetchSourceParagraphs(") +
  slice("  function isBibliographyReferenceLink(", "  function sliceTextRange(") +
  slice("  function translatedMappingCandidates(", "  function updateDocumentLine("), h);

function textRange(text, start = 0, end = text.length, parentElement = null) {
  const node = { nodeType: 3, length: text.length, textContent: text, parentElement };
  return {
    commonAncestorContainer: node,
    startContainer: node, startOffset: start, endContainer: node, endOffset: end,
    intersectsNode: () => true,
  };
}
const original = "The blinded experiment found a negative 25% change in endothelial cell proliferation after treatment.";

test("coverage preserves scientific quantities, signs, units and comparisons", () => {
  for (const [full, changed] of [
    ["测得2.5%的变化。", "测得25%的变化。"],
    ["测得.5%的变化。", "测得5%的变化。"],
    ["测得2,500个细胞。", "测得2500个细胞。"],
    ["−25%是变化幅度。", "25%是变化幅度。"],
    ["-25%是变化幅度。", "25%是变化幅度。"],
    ["+25%是变化幅度。", "25%是变化幅度。"],
    ["±5是误差。", "5是误差。"],
    ["阳性比例为25%。", "阳性比例为25。"],
    ["5<实际读数。", "5实际读数。"],
    ["实际读数≤5。", "实际读数5。"],
    ["速率为5/秒。", "速率为5秒。"],
    ["在12:30测量。", "在1230测量。"],
    ["测量5'端。", "测量5端。"],
    ["未发现任何作用。", "发现任何作用。"],
  ]) assert.notEqual(h.coverageKey(full), h.coverageKey(changed), `${full} must differ from ${changed}`);
});

test("ordinary prose punctuation and translator whitespace remain optional", () => {
  for (const [full, selected] of [
    ["结果显示，IL -33 有效（图2a）。", "结果显示IL-33有效图2a"],
    ["‘结果有效！’", "结果有效"],
    ["研究结果：变化明确；需要复核。", "研究结果变化明确需要复核"],
    ["The result was reproducible.", "The result was  reproducible."],
  ]) assert.equal(h.coverageKey(full), h.coverageKey(selected));
  assert.notEqual(h.coverageKey("The result was reproducible."), h.coverageKey("The result was reproducible"),
    "an ASCII point stays significant because it can belong to a decimal at a DOM fragment boundary");
});

test("decimal points and signs survive independent DOM fragment normalization", () => {
  for (const fragments of [["2", ".", "5%"], ["2.", "5%"], ["−", "25", "%"], ["5", "<", "10"]]) {
    assert.equal(fragments.map(h.coverageKey).join(""), h.coverageKey(fragments.join("")), fragments.join(" | "));
    assert.equal(fragments.map(part => h.selectionWithoutReferences(textRange(part))).join(""),
      h.selectionWithoutReferences(textRange(fragments.join(""))));
  }
});

test("the actual range coverage helper rejects omitted boundary signs and percentages", () => {
  for (const text of ["−25%是变化幅度。", "±5是误差。", "<5是读数。", "未发现任何作用。"]) {
    assert.notEqual(h.selectionWithoutReferences(textRange(text)), h.selectionWithoutReferences(textRange(text, 1)), text);
  }
  const text = "处理后阳性比例为25%。";
  assert.notEqual(h.selectionWithoutReferences(textRange(text)), h.selectionWithoutReferences(textRange(text, 0, text.indexOf("%"))));
  assert.equal(h.selectionWithoutReferences(textRange(text)), h.selectionWithoutReferences(textRange(text, 0, text.length - 1)));
});

test("reference links remain ignored while ordinary numerical text remains evidence", () => {
  const citation = {
    textContent: "20", parentElement: null,
    matches: selector => selector === "a[href]" || selector === "sup, a[href], [data-pb-sentence]",
    getAttribute: () => "#ref-CR20",
  };
  assert.equal(h.selectionWithoutReferences(textRange("20", 0, 2, citation)), "");
  assert.equal(h.selectionWithoutReferences(textRange("20")), "20");
  for (const href of ["https://example.org/reference-ranges", "#reference-ranges", "#Fig20"])
    assert.equal(h.selectionWithoutReferences(textRange("20", 0, 2, { ...citation, getAttribute: () => href })), "20");
});

test("whole-paragraph fast mapping never erases numeric punctuation or a boundary operator", () => {
  for (const [paragraph, exact] of [
    ["测得2.5%的变化。", "测得25%的变化。"],
    ["−25%是变化幅度。", "25%是变化幅度。"],
    ["<5是实际读数。", "5是实际读数。"],
    ["阳性比例为25%。", "阳性比例为25。"],
  ]) assert.equal(h.fastPositionMapping({ paragraph, exact }, original), null);
  assert.equal(h.fastPositionMapping({ paragraph: "结果（图2a）。", exact: "结果图2a" }, original).exact, original);
});

test("cross-block completeness cannot erase an unaccounted-for operator", async () => {
  await assert.rejects(h.mapTranslatedSelection({
    exact: "−25%是变化幅度。",
    parts: [{ exact: "25%是变化幅度。", paragraph: "25%是变化幅度。", originalParagraph: original }],
  }), /未识别/);
});
