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
const context = vm.createContext({
  Intl,
  sourceParagraphByKey: new Map(),
  normalizedReadableText: value => String(value || "").replace(/\s+/g, " ").trim(),
});
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
    name: "superscript-style citation separated from the period by whitespace stays with its sentence",
    raw: "Expression increased. 12,13 The control remained unchanged.",
    expected: ["Expression increased. 12,13", "The control remained unchanged."],
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
    name: "citation after an embryonic decimal timepoint starts the next sentence",
    raw: "Cardiac lymphatics populate the dorsal ventricle by E14.5.13 The nascent lymphatics then sprout from the sinus venosus region.14 By E18.5, the network is established.13",
    expected: [
      "Cardiac lymphatics populate the dorsal ventricle by E14.5.13",
      "The nascent lymphatics then sprout from the sinus venosus region.14",
      "By E18.5, the network is established.13",
    ],
  },
  {
    name: "a bare decimal followed by a capitalized continuation is not reclassified as a citation",
    raw: "The recorded value was 1.25 The source table omitted its unit.",
    expected: ["The recorded value was 1.25 The source table omitted its unit."],
  },
  {
    name: "an appendix outline label is not reclassified as a numeric citation boundary",
    raw: "B.6 Alternative Splicing The data set contains four tissue types. Each target contains four softmax units.",
    expected: [
      "B.6 Alternative Splicing The data set contains four tissue types.",
      "Each target contains four softmax units.",
    ],
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

test("stable sentence ordinal resolves the correct repeated source sentence", () => {
  const paragraph = "Expression increased. Expression increased. Controls remained stable.";
  const first = context.sentenceSourceBounds({text:"Expression increased.",sentenceIndex:0}, paragraph);
  const second = context.sentenceSourceBounds({text:"Expression increased.",sentenceIndex:1}, paragraph);
  assert.deepEqual({...first}, {start:0,end:21});
  assert.deepEqual({...second}, {start:22,end:43});
});

test("legacy records still fail closed when repeated source text has no ordinal", () => {
  const paragraph = "Expression increased. Expression increased.";
  assert.equal(context.sentenceSourceBounds({text:"Expression increased."}, paragraph), null);
});

test("numeric citation suffixes are terminal while bare decimal values are not", () => {
  assert.equal(context.englishSentenceEndsAtTerminal("The network is established.13"), true);
  assert.equal(context.englishSentenceEndsAtTerminal("The network is established.[13–15]"), true);
  assert.equal(context.englishSentenceEndsAtTerminal("The embryo was assessed at E14.5.13"), true);
  assert.equal(context.englishSentenceEndsAtTerminal("The embryo was assessed at E14.5"), false);
  assert.equal(context.englishSentenceEndsAtTerminal("The measured value was 1.25"), false);
  assert.equal(context.englishSentenceEndsAtTerminal("Appendix B.6"), false);
});


test("a cached sentence ending with references stays one sentence when inspected alone", () => {
  for (const text of ["Function remained stable. 6 , 7", "Expression increased.[12–15]", "The network forms by E18.5.13"]) {
    assert.equal(context.englishSentenceSegments(text).length, 1, text);
  }
});

test("normalized source offsets recover exact DOM ranges across reference newlines and UTF-16 symbols", () => {
  const from = source.indexOf("  function normalizedReadableText(");
  const to = source.indexOf("  function looksPrimarilyEnglish(", from);
  const offsets = vm.createContext({});
  vm.runInContext(source.slice(from, to), offsets);
  const samples = [
    "  Cardiac function remained stable.\n6\n, \n7\n Next sentence.  ",
    "Gene VEGF-C\u00a0156S remained stable.\r\nReference 12.",
    "Cells 🧬 retain α-SMA+ and VEGFR-3f/−. Second sentence.",
    "Expression <sup> + </sup> changed.&nbsp;Controls remained stable.",
  ];
  for (const raw of samples) {
    const p = offsets.readableTextProjection(raw);
    assert.equal(p.text, offsets.normalizedReadableText(raw));
    assert.equal(p.starts.length, p.text.length);
    assert.equal(p.ends.length, p.text.length);
    for (const part of context.englishSentenceSegments(p.text)) {
      const start = part.index + part.segment.length - part.segment.trimStart().length;
      const end = part.index + part.segment.trimEnd().length;
      assert.equal(offsets.normalizedReadableText(raw.slice(p.starts[start], p.ends[end - 1])), part.segment.trim());
    }
  }
});

for (const [name, raw, expected] of [
  ['company suffix before dilution', 'Secondary antibodies were purchased from Sino Biological Inc. (1:2000). Controls remained stable.', ['Secondary antibodies were purchased from Sino Biological Inc. (1:2000).', 'Controls remained stable.']],
  ['company suffix before supplier address', 'Reagents came from Example Ltd. (Cambridge, UK). Controls remained stable.', ['Reagents came from Example Ltd. (Cambridge, UK).', 'Controls remained stable.']],
  ['company suffix at a real sentence end', 'Reagents came from Example Inc. Controls remained stable.', ['Reagents came from Example Inc.', 'Controls remained stable.']],
]) test(name, () => assert.deepEqual(checkedSegments(raw), expected));
