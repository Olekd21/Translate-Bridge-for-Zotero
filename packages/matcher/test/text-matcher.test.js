import test from "node:test";
import assert from "node:assert/strict";
import {
  findTextCandidates,
  locateQuote,
  locateQuoteInPages,
  normalizeText,
  pageForOffset,
} from "../src/text-matcher.js";

test("normalizes PDF line-break hyphenation, ligatures, quotes, and whitespace", () => {
  assert.equal(normalizeText("Condi-\n tionally  \ufb01xed \u2018text\u2019"), "conditionally fixed 'text'");
});

test("uses prefix and suffix to rank repeated quotations", () => {
  const document = "first alpha beta omega. second alpha beta delta.";
  const candidates = findTextCandidates(document, {
    exact: "alpha beta",
    prefix: "second ",
    suffix: " delta",
  });
  assert.equal(candidates.length, 2);
  assert.ok(candidates[0].score > candidates[1].score);
});

test("maps a character offset to a zero-based page index", () => {
  assert.deepEqual(pageForOffset([10, 20, 30], 12), {
    pageIndex: 1,
    pageLabel: "2",
    pageOffset: 2,
  });
});

test("reports a unique quotation and its page", () => {
  const result = locateQuote("page one text page two unique quote", [14, 20], {
    exact: "unique quote",
    prefix: "page two ",
    suffix: "",
  });
  assert.equal(result.status, "unique");
  assert.equal(result.candidates[0].page.pageIndex, 1);
});

test("page matching does not drift when normalization changes page length", () => {
  const result = locateQuoteInPages(
    [
      { text: "Page one contains many     spaces." },
      { text: "To conditionally delete Prox1 from LECs." },
    ],
    { exact: "To conditionally delete Prox1 from LECs." },
  );

  assert.equal(result.status, "unique");
  assert.equal(result.candidates[0].page.pageIndex, 1);
});
