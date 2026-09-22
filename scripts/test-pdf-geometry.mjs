import assert from "node:assert/strict";
import process from "node:process";
import { build } from "../packages/zotero-addon/node_modules/esbuild/lib/main.js";

const bundle = await build({
  entryPoints: ["packages/zotero-addon/src/modules/pdfGeometry.ts"],
  absWorkingDir: process.cwd(),
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`;
const { locateQuoteGeometry } = await import(moduleUrl);

if (process.argv.includes("--stdin")) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const fixture = JSON.parse(input);
  const result = locateQuoteGeometry(fixture.data, fixture.selector);
  assert.equal(result.pageIndex, fixture.expectedPageIndex ?? 0);
  assert.ok(result.rects?.length);
  console.log(JSON.stringify(result));
  process.exit(0);
}

function word(x, y, text, spaceAfter = true) {
  return [
    x,
    y,
    x + Math.max(18, text.length * 4),
    y + 10,
    10,
    spaceAfter ? 1 : 0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    text,
  ];
}

const lines = [
  [[word(40, 100, "The heart has a complex network of lymphatic ves-", false)]],
  [[word(340, 100, "andcardiacfunction. However this", false)]],
  [[word(40, 120, "sels that maintain fluid balance", false)]],
  [[word(340, 120, "roleremainsunknown.", false)]],
];
const page = [600, 800, [[[[0, 0, 0, 0, lines]]]]];
const result = locateQuoteGeometry(
  { pages: [page] },
  {
    type: "TextQuoteSelector",
    exact:
      "The heart has a complex network of lymphatic vessels that maintain fluid balance and cardiac function. However this role remains unknown.",
  },
);

assert.equal(result.pageIndex, 0);
assert.equal(result.method, "column-compact-character-sequence");
assert.ok(result.rects?.length);
console.log(
  "PDF geometry regression passed: glued words + interleaved columns",
);

const makePage = (rows) => [
  600,
  800,
  [[[[0, 0, 0, 0, rows.map(([x, y, text]) => [[word(x, y, text)]])]]]],
];
const firstHalf =
  "Thus these results demonstrate for the first time that activation of the VEGF C VEGFR axis exerts a protective";
const secondHalf =
  "effect during the transition from cardiac hypertrophy to heart failure and highlights selective stimulation of cardiac lymphangiogenesis as a potential new therapeutic approach";
const firstPage = makePage([
  [200, 530, firstHalf],
  [45, 650, "Abbreviations and copyright text that must never be highlighted"],
]);
const secondPage = makePage([
  [45, 20, "Journal running header"],
  [200, 70, secondHalf],
]);
const crossSelector = {
  type: "TextQuoteSelector",
  exact: `${firstHalf} ${secondHalf}`,
};
const cross = locateQuoteGeometry(
  { pages: [firstPage, secondPage] },
  crossSelector,
);
assert.equal(cross.status, "unique");
assert.equal(cross.pageIndex, 0);
assert.equal(cross.method, "cross-page-compact-character-sequence");
assert.deepEqual(
  cross.rects.map((r) => r[1]),
  [260],
);
assert.deepEqual(
  cross.nextPageRects.map((r) => r[1]),
  [720],
);
assert.ok(!cross.text.includes("copyright"));
assert.ok(!cross.text.includes("header"));

const missingHalf = locateQuoteGeometry(
  { pages: [firstPage, makePage([[45, 70, "Unrelated article text"]])] },
  crossSelector,
);
assert.equal(missingHalf.status, "not-found");
assert.equal(missingHalf.rects, undefined);
const nonAdjacent = locateQuoteGeometry(
  { pages: [firstPage, makePage([]), secondPage] },
  crossSelector,
);
assert.equal(nonAdjacent.status, "not-found");
const repeated = locateQuoteGeometry(
  { pages: [firstPage, secondPage, firstPage, secondPage] },
  crossSelector,
);
assert.equal(repeated.status, "ambiguous");
assert.equal(repeated.rects, undefined);
const singlePage = locateQuoteGeometry(
  { pages: [makePage([[40, 100, crossSelector.exact]])] },
  crossSelector,
);
assert.equal(singlePage.status, "unique");
assert.equal(singlePage.nextPageRects, undefined);
console.log(
  "PDF cross-page regressions passed: two-page geometry, footers excluded, missing/nonadjacent/ambiguous matches rejected, single-page preserved",
);

const laterPages = Array.from({ length: 12 }, () => makePage([]));
laterPages.push(makePage([[40, 100, crossSelector.exact]]));
assert.equal(
  locateQuoteGeometry({ pages: laterPages }, crossSelector).pageIndex,
  12,
);
const duplicateLocations = locateQuoteGeometry(
  { pages: [...laterPages, laterPages[12]] },
  crossSelector,
);
assert.equal(duplicateLocations.status, "ambiguous");
assert.equal(duplicateLocations.pageIndex, undefined);
assert.equal(duplicateLocations.rects, undefined);
// Both reading orders find this same word geometry after dehyphenation.
const compactQuery =
  "These findings demonstrate robust lymphangiogenesis supporting myocardial growth and repair during chronic pressure overload induced hypertrophy";
const sameLocation = locateQuoteGeometry(
  {
    pages: [
      makePage([
        [
          40,
          100,
          compactQuery.replace("lymphangiogenesis", "lymphangio-genesis"),
        ],
      ]),
    ],
  },
  { type: "TextQuoteSelector", exact: compactQuery },
);
assert.equal(sameLocation.status, "unique");
assert.equal(sameLocation.occurrences, 1);
const batchBoundaryPages = Array.from({ length: 4 }, () => makePage([]));
batchBoundaryPages.push(firstPage, secondPage);
const acrossBatch = locateQuoteGeometry(
  { pages: batchBoundaryPages },
  crossSelector,
);
assert.equal(acrossBatch.pageIndex, 4);
assert.ok(acrossBatch.nextPageRects.length);
console.log(
  "Full-document geometry passed: page 13, true duplicates rejected, same-location strategies deduplicated, batch boundary cross-page match",
);
