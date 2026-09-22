import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractPdf } from "./pdf-extractor.js";
import { locateQuoteInPages } from "./text-matcher.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPdf = path.resolve(currentDirectory, "../../../.cache/samples/s41586-020-2998-x.pdf");
const pdfPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultPdf;

const selector = {
  exact:
    "To conditionally delete Prox1 from LECs, we crossed Cad5(PAC)-CreERT2 mice with Prox1 floxed mice and injected pregnant females with tamoxifen at E13.5 and E14.5.",
  prefix:
    "germ-line deletion of Prox1 in mice results in complete lack of LECs and embryonic lethality at around E14.5.",
  suffix: "Analysis of E17.5",
};

const extracted = await extractPdf(pdfPath);
const result = locateQuoteInPages(extracted.pages, selector);

console.log(
  JSON.stringify(
    {
      pdfPath,
      pageCount: extracted.pages.length,
      selector,
      result,
    },
    null,
    2,
  ),
);

if (result.status === "not-found") process.exitCode = 2;
