import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

// Focused source-segmentation regression. These sentences are constructed
// grammar examples, not claims from a paper or a live Chrome Translate audit.
// Only explicitly recognizable abbreviations are exercised; the suite does
// not require guessing an arbitrary word ending in a period.
// Run: node --test scripts/test-english-sentence-segmentation.mjs
// Optional: PAPERBRIDGE_CONTENT_SOURCE points to an unchanged old content.js.
const sourcePath = process.env.PAPERBRIDGE_CONTENT_SOURCE ||
  new URL("../packages/browser-extension/content.js", import.meta.url);
const source = await fs.readFile(sourcePath, "utf8");
const start = source.indexOf("  function englishSentenceSegments(");
const end = source.indexOf("  function preserveSentenceBoundaries(", start);
assert.ok(start >= 0 && end > start, "actual English segmentation function was not found");
const context = vm.createContext({ Intl });
vm.runInContext(source.slice(start, end), context);
console.log(JSON.stringify({
  fixture: "english-sentence-segmentation",
  sourceSHA256: crypto.createHash("sha256").update(source).digest("hex"),
  node: process.version,
  icu: process.versions.icu,
}));

const cases = [
  {
    name: "No followed by pronoun I is a true sentence boundary, not a Roman numeral",
    expected: ["No.", "I did not observe the response."],
  },
  {
    name: "scientific time units at sentence ends do not swallow following gene names",
    expected: ["Cells were treated for 24 h.", "IL-33 expression increased after treatment."],
  },
  {
    name: "minute abbreviation at a sentence end preserves the next sentence",
    expected: ["Samples were washed for 5 min.", "They were then fixed."],
  },
  {
    name: "Fig.4 without a space inside a sentence",
    expected: ["As shown in Fig.4, the signal increased.", "Controls remained stable."],
  },
  {
    name: "Fig. 4 with a space inside a sentence",
    expected: ["As shown in Fig. 4, the signal increased.", "Controls remained stable."],
  },
  {
    name: "Figs.4a,b panel list without a space",
    expected: ["Figs.4a,b show the response.", "Controls remained stable."],
  },
  {
    name: "Figs. 4a,b panel list with a space",
    expected: ["Figs. 4a,b show the response.", "Controls remained stable."],
  },
  {
    name: "parenthesized Fig. 4 retains its number and closing bracket",
    expected: ["The response increased (Fig. 4).", "Controls remained stable."],
  },
  {
    name: "parenthesized Fig.4 retains its true following sentence boundary",
    expected: ["The response increased (Fig.4).", "Controls remained stable."],
  },
  {
    name: "parenthesized Figs. 4a,b remains one source sentence",
    expected: ["The responses were concordant (Figs. 4a,b).", "Controls remained stable."],
  },
  {
    name: "Extended Data Fig. 4 inside a sentence",
    expected: ["Extended Data Fig. 4 shows the independent validation.", "The data were reproducible."],
  },
  {
    name: "parenthesized Extended Data Fig. 4",
    expected: ["The result was validated (Extended Data Fig. 4).", "The data were reproducible."],
  },
  {
    name: "parenthesized Extended Data Fig.4 with no space before the number",
    expected: ["The result was validated (Extended Data Fig.4).", "The data were reproducible."],
  },
  {
    name: "multiple figure references in one parenthesis",
    expected: ["The response persisted (Fig. 4; Extended Data Fig. 2a).", "A second assay confirmed it."],
  },
  {
    name: "figure reference in a sentence containing later independent text",
    expected: ["The signal increased (Fig. 4), whereas the controls remained stable.", "A second assay confirmed it."],
  },
  {
    name: "e.g. followed by a capitalized scientific identifier",
    expected: ["We tested several cytokines, e.g. IL-33 and IL-1.", "Controls remained stable."],
  },
  {
    name: "e.g. followed by a lower-case common noun",
    expected: ["We tested several organs, e.g. heart and lung.", "The controls were matched."],
  },
  {
    name: "parenthesized e.g. followed by a capitalized scientific identifier",
    expected: ["Several cytokines were measured (e.g. IL-33 and IL-1).", "Controls remained stable."],
  },
  {
    name: "i.e. followed by an uppercase assay abbreviation",
    expected: ["The assay measures electrical resistance, i.e. TEER.", "Controls remained stable."],
  },
  {
    name: "i.e. followed by a lower-case explanation",
    expected: ["The assay measures permeability, i.e. solute passage across the barrier.", "Controls remained stable."],
  },
  {
    name: "et al. followed by an explicit parenthesized citation year",
    expected: ["This protocol follows Smith et al. (2024).", "We validated it independently."],
  },
  {
    name: "et al. followed by a comma and year",
    expected: ["This protocol follows Smith et al., 2024.", "We validated it independently."],
  },
  {
    name: "et al. followed by a lower-case continuation",
    expected: ["Smith et al. reported a similar response.", "We validated it independently."],
  },
  {
    name: "vs. followed by an uppercase identifier",
    expected: ["We compared IL-33 vs. IL-1 in the same assay.", "Controls remained stable."],
  },
  {
    name: "vs. followed by a numeric dose",
    expected: ["We compared 10 mg vs. 20 mg of the drug.", "Controls remained stable."],
  },
  {
    name: "decimal values and inequality symbols are not sentence boundaries",
    expected: ["The mean was 1.25 mg, with P < 0.05 and a ratio of 2.50.", "The estimate was reproducible."],
  },
  {
    name: "scientific notation and signed decimals retain the whole sentence",
    expected: ["The change was -0.25 V at 1.5 × 10−3 A.", "The instrument remained stable."],
  },
  {
    name: "abbreviated honorific with an explicit surname",
    expected: ["Dr. Smith measured 1.25 mg in the laboratory.", "The controls were matched."],
  },
  {
    name: "geographic abbreviation before a lower-case noun",
    expected: ["The U.S. laboratory measured 1.25 mg of protein.", "The controls were matched."],
  },
  {
    name: "number abbreviation before an explicit numeric group identifier",
    expected: ["Group No. 4 received the active treatment.", "The controls were matched."],
  },
  {
    name: "true boundary after a terminal figure reference must remain",
    expected: ["The result is shown in Fig. 4.", "Controls remained stable."],
  },
  {
    name: "true boundary after terminal et al. must remain",
    expected: ["The approach was reported by Smith et al.", "We validated it independently."],
  },
  {
    name: "true boundary after a terminal geographic abbreviation must remain",
    expected: ["The measurements were performed in the U.S.", "We validated them independently."],
  },
  {
    name: "a standalone parenthesized figure reference does not absorb the next sentence",
    expected: ["The marker increased.", "(Fig. 4).", "Controls remained stable."],
  },
  {
    name: "ordinary declarative sentences remain separate",
    expected: ["The marker increased.", "Controls remained stable.", "The assay was repeated."],
  },
  {
    name: "question and exclamation marks remain real sentence boundaries",
    expected: ["Was the response reproducible?", "Yes!", "The controls remained stable."],
  },
  {
    name: "existing citation-after-period recovery remains effective",
    raw: "Expression increased.12 The control remained unchanged.",
    expected: ["Expression increased.12", "The control remained unchanged."],
  },
  {
    name: "bracketed citation after a period stays attached to the preceding sentence",
    raw: "Expression increased.[12,13] The control remained unchanged.",
    expected: ["Expression increased.[12,13]", "The control remained unchanged."],
  },
  {
    name: "figure reference plus terminal citation does not create an extra fragment",
    raw: "The marker increased (Fig. 4).12 The control remained unchanged.",
    expected: ["The marker increased (Fig. 4).12", "The control remained unchanged."],
  },
  {
    name: "UTF-16 offsets survive astral symbols, Greek text and decimal values",
    expected: ["The 🧪 assay measured β-catenin at 1.25 μg/ml (Fig. 4).", "The measured pH was 7.40."],
  },
  {
    name: "leading whitespace, nonbreaking figure space and CRLF are preserved",
    raw: " \tThe signal increased (Fig.\u00a04).\r\nThe control remained stable.  ",
    expected: ["The signal increased (Fig.\u00a04).", "The control remained stable."],
  },
];

function checkedSegments(raw) {
  const result = Array.from(context.englishSentenceSegments(raw), part => ({
    index: part.index, segment: part.segment,
  }));
  let nextOffset = 0;
  for (const part of result) {
    assert.equal(typeof part.segment, "string", "a segment must contain unchanged source text");
    assert.ok(part.segment.length > 0, "empty segments cannot anchor a DOM range");
    assert.equal(part.index, nextOffset, "segments contain a gap, overlap or wrong UTF-16 offset");
    assert.equal(raw.slice(part.index, part.index + part.segment.length), part.segment,
      "segment text differs from its claimed original DOM offsets");
    nextOffset += part.segment.length;
  }
  assert.equal(nextOffset, raw.length, "source text was lost at the end");
  assert.equal(result.map(part => part.segment).join(""), raw, "source characters were deleted, rewritten or duplicated");
  return result.map(part => part.segment.trim()).filter(Boolean);
}

for (const example of cases) {
  test(example.name, () => {
    const raw = example.raw ?? example.expected.join(" ");
    assert.deepEqual(checkedSegments(raw), example.expected);
  });
}

test("empty source returns no sentence and preserves empty coverage", () => {
  assert.deepEqual(checkedSegments(""), []);
});
