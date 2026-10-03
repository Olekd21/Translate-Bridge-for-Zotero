import { normalizeText, type TextQuoteSelector } from "./textMatcher";

type Rect = [number, number, number, number];
type RecognizerWord = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
];

export type RecognizerData = {
  totalPages?: number;
  pages?: unknown[];
};

export type GeometryMatch = {
  status: "unique" | "ambiguous" | "not-found";
  occurrences: number;
  pageIndex?: number;
  pageLabel?: string;
  rects?: Rect[];
  nextPageRects?: Rect[];
  additionalPages?: { pageIndex: number; rects: Rect[]; text: string; offset: number; top: number }[];
  text?: string;
  score?: number;
  method?:
    | "exact-token-sequence"
    | "compact-character-sequence"
    | "column-compact-character-sequence"
    | "cross-page-compact-character-sequence"
    | "ordered-token-window"
    | "fragment-window";
  offset?: number;
  top?: number;
};

type PageWord = {
  text: string;
  rect: Rect;
  lineIndex: number;
  wordIndex: number;
  charOffset: number;
  spaceAfter: boolean;
};

type PageToken = {
  value: string;
  word: PageWord;
};

type Candidate = {
  pageIndex: number;
  startToken: number;
  endToken: number;
  score: number;
  method:
    | "exact-token-sequence"
    | "compact-character-sequence"
    | "column-compact-character-sequence"
    | "ordered-token-window"
    | "fragment-window";
  words: PageWord[];
  pageHeight: number;
};

// Recognizer results are immutable and owned by the bounded PDF cache. Weak
// keys avoid retaining old documents while reusing expensive text indexes.
const wordCache = new WeakMap<object, { height: number; words: PageWord[] }>();
const tokenCache = new WeakMap<PageWord[], PageToken[]>();
const columnCache = new WeakMap<PageWord[], PageWord[]>();
const compactCache = new WeakMap<
  PageWord[],
  { text: string; owners: PageWord[] }
>();

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function textTokens(value: string): string[] {
  return Array.from(
    normalizeText(value)
      .replace(/\u00ad/g, "")
      .replace(/[‐‑−–]/g, "-")
      .replace(/([+-])\s+(?=\d)/g, "$1")
      .matchAll(
        /[\p{L}][\p{L}\p{N}]*|[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?|[<>=≤≥≠±]/gu,
      ),
    (match) => match[0],
  );
}

function isRecognizerWord(value: unknown): value is RecognizerWord {
  return (
    Array.isArray(value) &&
    value.length >= 14 &&
    value.slice(0, 4).every((part) => Number.isFinite(part)) &&
    value[2] > value[0] &&
    value[3] > value[1] &&
    typeof value[13] === "string"
  );
}

function pageWords(rawPage: unknown): { height: number; words: PageWord[] } {
  if (!Array.isArray(rawPage)) return { height: 0, words: [] };
  const cached = wordCache.get(rawPage);
  if (cached) return cached;
  const height = Number(rawPage[1]) || 0;
  const lines = (rawPage as any)?.[2]?.[0]?.[0]?.[0]?.[4];
  if (!Array.isArray(lines)) return { height, words: [] };

  const words: PageWord[] = [];
  let charOffset = 0;
  lines.forEach((line: unknown, lineIndex: number) => {
    const rawWords = Array.isArray(line) ? line[0] : undefined;
    if (!Array.isArray(rawWords)) return;
    rawWords.forEach((rawWord: unknown) => {
      if (!isRecognizerWord(rawWord)) return;
      const text = rawWord[13];
      words.push({
        text,
        rect: [rawWord[0], rawWord[1], rawWord[2], rawWord[3]],
        lineIndex,
        wordIndex: words.length,
        charOffset,
        spaceAfter: Boolean(rawWord[5]),
      });
      charOffset += text.length + (rawWord[5] ? 1 : 0);
    });
  });
  const result = { height, words };
  wordCache.set(rawPage, result);
  return result;
}

function pageTokens(words: PageWord[]): PageToken[] {
  const cached = tokenCache.get(words);
  if (cached) return cached;
  const result = words.flatMap((word) =>
    textTokens(word.text).map((value) => ({ value, word })),
  );
  tokenCache.set(words, result);
  return result;
}

const numericCitation = /\[\s*\d+(?:\s*[,–−-]\s*\d+)*\s*\]/g;
// Explicit orthographic equivalents only: never stem arbitrary gene names or
// drop scientific numbers. Preserve character ownership for PDF rectangles.
function canonicalScientificText(raw: string, owners?: PageWord[]) {
  const spellings: Record<string, string> = {
    generalised: "generalized", normalised: "normalized", unnormalised: "unnormalized",
    characterised: "characterized", specialised: "specialized", analysed: "analyzed", signalling: "signaling",
    remodelling: "remodeling", ischaemic: "ischemic", ischaemia: "ischemia",
    oedema: "edema", hyperglycaemia: "hyperglycemia", hyperlipidaemia: "hyperlipidemia",
    hypercholesterolaemia: "hypercholesterolemia", ageing: "aging",
  };
  const replacements: {start:number;end:number;text:string}[] = [];
  for (const match of raw.matchAll(/\b[a-z]+\b/g)) {
    if (spellings[match[0]]) replacements.push({start:match.index!,end:match.index!+match[0].length,text:spellings[match[0]]});
  }
  // Sentence-final reference runs: preserve their complete numeric set, merely
  // expand bounded ranges (54–56 => 54,55,56); never strip bare numbers.
  for (const match of raw.matchAll(/(?<=[a-z)])\s*(\d{1,3}(?:\s*[,–-]\s*\d{1,3})+)(?!\d|\.\d)(?=[,.;:]|\s*[a-z])/g)) {
    const value = match[1];
    // A comma-only run already has the same compact text. Rewriting its spaces
    // would shift digit ownership onto punctuation in the PDF geometry index.
    if (!/[–-]/.test(value)) continue;
    const parts = value.split(','); const expanded: string[] = []; let valid = true;
    for (const part of parts) {
      const range = part.trim().match(/^(\d+)[–-](\d+)$/);
      if (range) {
        const from = Number(range[1]), to = Number(range[2]);
        if (to < from || to - from > 20) {valid=false;break;}
        for (let n=from;n<=to;n++) expanded.push(String(n));
      } else if (/^\s*\d+\s*$/.test(part)) expanded.push(part.trim());
      else {valid=false;break;}
    }
    if (valid) replacements.push({start:match.index!,end:match.index!+match[0].length,text:expanded.join(',')});
  }
  replacements.sort((a,b)=>a.start-b.start);
  let cursor=0, text=""; const mapped: PageWord[]=[];
  for (const replacement of replacements) {
    text += raw.slice(cursor,replacement.start) + replacement.text;
    if (owners) {
      mapped.push(...owners.slice(cursor,replacement.start));
      for(let i=0;i<replacement.text.length;i++) mapped.push(owners[Math.min(replacement.start+i,replacement.end-1)]);
    }
    cursor=replacement.end;
  }
  text += raw.slice(cursor); if (owners) mapped.push(...owners.slice(cursor));
  return {text,owners:mapped};
}
function compactCharacters(value: string, useSpellings = true) {
  // Ignore explicit bracketed references, NOT scientific numbers/gene IDs.
  const normalized = normalizeText(value)
    .replace(/\u00ad/g, "")
    .replace(numericCitation, "")
    .replace(/[‐‑−–]/g, "-");
  const raw = useSpellings ? canonicalScientificText(normalized).text : normalized;
  let result = "";
  for (let i = 0; i < raw.length; ) {
    const char = String.fromCodePoint(raw.codePointAt(i)!);
    if (keepCompactCharacter(raw, i, char)) result += char;
    i += char.length;
  }
  return result;
}

function keepCompactCharacter(raw: string, index: number, char: string) {
  return (
    /[\p{L}\p{N}<>=≤≥≠±]/u.test(char) ||
    ((char === "+" || char === "-") && /^\s*\d/.test(raw.slice(index + 1))) ||
    (char === "." &&
      /\d/.test(raw[index + 1] || "") &&
      (/\d/.test(raw[index - 1] || "") ||
        ((index === 0 || /\s/.test(raw[index - 1])) &&
          !/(?:\.|\b(?:fig|eq|no|vol|pp|sect))\s*$/.test(raw.slice(0, index)))))
  );
}

const literalCompactCache = new WeakMap<PageWord[], { text: string; owners: PageWord[] }>();
function compactIndex(words: PageWord[], useSpellings = true) {
  const indexCache = useSpellings ? compactCache : literalCompactCache;
  const cached = indexCache.get(words);
  if (cached) return cached;
  let raw = "";
  let rawOwners: PageWord[] = [];
  for (const word of words) {
    const normalized = normalizeText(word.text).replace(/\u00ad/g, "").replace(/[‐‑−–]/g, "-");
    const text = (useSpellings ? canonicalScientificText(normalized).text : normalized) +
      (word.spaceAfter ? " " : "");
    raw += text;
    for (let i = 0; i < text.length; i++) rawOwners.push(word);
  }
  const canonical = useSpellings ? canonicalScientificText(raw, rawOwners) : {text: raw, owners: rawOwners};
  raw = canonical.text; rawOwners = canonical.owners;
  const citationSpans = [...raw.matchAll(numericCitation)];
  let text = "";
  const owners: PageWord[] = [];
  let span = 0;
  for (let i = 0; i < raw.length; ) {
    const citation = citationSpans[span];
    if (citation && i === citation.index) {
      i += citation[0].length;
      span++;
      continue;
    }
    const char = String.fromCodePoint(raw.codePointAt(i)!);
    if (keepCompactCharacter(raw, i, char)) {
      text += char;
      for (let j = 0; j < char.length; j++) owners.push(rawOwners[i]);
    }
    i += char.length;
  }
  const result = { text, owners };
  indexCache.set(words, result);
  return result;
}

function wordsInColumnOrder(words: PageWord[], pageWidth: number) {
  const cached = columnCache.get(words);
  if (cached) return cached;
  const lines = new Map<number, PageWord[]>();
  for (const word of words) {
    const line = lines.get(word.lineIndex) || [];
    line.push(word);
    lines.set(word.lineIndex, line);
  }
  // Detect separated left margins rather than assuming every paper has two
  // equal columns. Native order is still tried independently.
  const margins = [
    ...new Set(
      Array.from(lines.values(), (line) =>
        Math.min(...line.map((word) => word.rect[0])),
      ),
    ),
  ].sort((a, b) => a - b);
  const gaps = margins
    .slice(1)
    .flatMap((margin, i) =>
      margin - margins[i] > pageWidth * 0.18 ? [(margin + margins[i]) / 2] : [],
    );
  const boundaries =
    gaps.length > 0 && gaps.length <= 3 ? gaps : [pageWidth / 2];
  const result = Array.from(lines.values())
    .map((line) => ({
      line,
      column: boundaries.filter(
        (boundary) => Math.min(...line.map((word) => word.rect[0])) >= boundary,
      ).length,
      top: Math.min(...line.map((word) => word.rect[1])),
      left: Math.min(...line.map((word) => word.rect[0])),
    }))
    .sort(
      (left, right) =>
        left.column - right.column ||
        left.top - right.top ||
        left.left - right.left,
    )
    .flatMap(({ line }) => line);
  columnCache.set(words, result);
  return result;
}

function compactCharacterCandidatesForMode(
  words: PageWord[],
  pageIndex: number,
  pageHeight: number,
  queryText: string,
  method: "compact-character-sequence" | "column-compact-character-sequence",
  useSpellings: boolean,
  minimumCharacters = 24,
): Candidate[] {
  const query = compactCharacters(queryText, useSpellings);
  if (query.length < minimumCharacters) return [];

  const { text: page, owners } = compactIndex(words, useSpellings);

  const candidates: Candidate[] = [];
  let cursor = 0;
  while (cursor <= page.length - query.length) {
    const index = page.indexOf(query, cursor);
    if (index === -1) break;
    const matchedWords: PageWord[] = [];
    let previous = -1;
    for (let offset = index; offset < index + query.length; offset += 1) {
      const word = owners[offset];
      if (word && word.wordIndex !== previous) matchedWords.push(word);
      previous = word?.wordIndex ?? previous;
    }
    if (matchedWords.length) {
      candidates.push({
        pageIndex,
        startToken: matchedWords[0].wordIndex,
        endToken: matchedWords[matchedWords.length - 1].wordIndex,
        score: method === "column-compact-character-sequence" ? 0.97 : 0.95,
        method,
        words: matchedWords,
        pageHeight,
      });
    }
    cursor = index + Math.max(1, query.length);
  }
  return candidates;
}

// Keep the literal path independent of spelling aliases: a recognizer can join
// adjacent words or split an alias across lines. Applying aliases to only one
// side must never destroy an otherwise exact textual match. Collect both paths
// so repeated locations still reach the ambiguity check.
function compactCharacterCandidates(
  words: PageWord[], pageIndex: number, pageHeight: number, queryText: string,
  method: "compact-character-sequence" | "column-compact-character-sequence",
  minimumCharacters = 24,
): Candidate[] {
  return [
    ...compactCharacterCandidatesForMode(words, pageIndex, pageHeight, queryText, method, false, minimumCharacters),
    ...compactCharacterCandidatesForMode(words, pageIndex, pageHeight, queryText, method, true, minimumCharacters),
  ];
}

function sequenceStarts(tokens: PageToken[], sequence: string[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (
      sequence.every((value, offset) => tokens[index + offset].value === value)
    ) {
      starts.push(index);
    }
  }
  return starts;
}

function candidatesForPage(
  rawPage: unknown,
  pageIndex: number,
  query: string[],
  prefix: string[],
  suffix: string[],
  queryText: string,
): Candidate[] {
  const { height, words } = pageWords(rawPage);
  const tokens = pageTokens(words);
  if (!tokens.length || !query.length) return [];

  const exact = sequenceStarts(tokens, query).map((startToken) => {
    const endToken = startToken + query.length - 1;
    const prefixWindow = prefix.slice(-8);
    const suffixWindow = suffix.slice(0, 8);
    const prefixMatches =
      prefixWindow.length > 0 &&
      startToken >= prefixWindow.length &&
      prefixWindow.every(
        (value, offset) =>
          tokens[startToken - prefixWindow.length + offset].value === value,
      );
    const suffixMatches =
      suffixWindow.length > 0 &&
      endToken + suffixWindow.length < tokens.length &&
      suffixWindow.every(
        (value, offset) => tokens[endToken + 1 + offset].value === value,
      );
    return {
      pageIndex,
      startToken,
      endToken,
      score: 1 + (prefixMatches ? 0.5 : 0) + (suffixMatches ? 0.5 : 0),
      method: "exact-token-sequence" as const,
      // Include punctuation between boundary words, retaining decimal points
      // and citation brackets for scientific-number validation.
      words: words.slice(
        tokens[startToken].word.wordIndex,
        tokens[endToken].word.wordIndex + 1,
      ),
      pageHeight: height,
    };
  });
  if (exact.length) return exact;

  const compact = compactCharacterCandidates(
    words,
    pageIndex,
    height,
    queryText,
    "compact-character-sequence",
  );
  const pageWidth = Number((rawPage as any)?.[0]) || 0;
  const columnCompact = pageWidth
    ? compactCharacterCandidates(
        wordsInColumnOrder(words, pageWidth),
        pageIndex,
        height,
        queryText,
        "column-compact-character-sequence",
      )
    : [];
  if (compact.length || columnCompact.length) {
    return [...columnCompact, ...compact];
  }

  // A bounded word-level fallback: the definite article may differ, but every content
  // token (including negation, numbers and gene IDs) must remain in order.
  // Avoid broad similarity scores that hide a changed scientific claim.
  const articles = new Set(["the"]);
  const contentQuery = query.filter((value) => !articles.has(value));
  if (contentQuery.length < 8) return [];
  const tolerant: Candidate[] = [];
  for (const ordered of [words, wordsInColumnOrder(words, pageWidth)]) {
    const indexed = pageTokens(ordered);
    const content = indexed.map((token, index) => ({ token, index }))
      .filter(({ token }) => !articles.has(token.value));
    for (let start = 0; start <= content.length - contentQuery.length; start++) {
      if (!contentQuery.every((value, offset) => content[start + offset].token.value === value)) continue;
      const first = content[start].index;
      const last = content[start + contentQuery.length - 1].index;
      const extra = Math.abs((last - first + 1) - query.length);
      if (extra > 2) continue;
      const firstWord = indexed[first].word;
      const lastWord = indexed[last].word;
      const left = ordered.indexOf(firstWord);
      const right = ordered.indexOf(lastWord);
      tolerant.push({ pageIndex, startToken: first, endToken: last,
        score: 0.94, method: "ordered-token-window",
        words: ordered.slice(left, right + 1), pageHeight: height });
    }
  }
  return tolerant;
}

function rectsForCandidate(candidate: Candidate): Rect[] {
  const grouped = new Map<number, PageWord[]>();
  for (const word of candidate.words) {
    const line = grouped.get(word.lineIndex) || [];
    line.push(word);
    grouped.set(word.lineIndex, line);
  }

  const segments: PageWord[][] = [];
  for (const line of grouped.values()) {
    const ordered = [...line].sort((a, b) => a.rect[0] - b.rect[0]);
    let segment: PageWord[] = [];
    for (const word of ordered) {
      const previous = segment[segment.length - 1];
      if (
        previous &&
        word.rect[0] - previous.rect[2] >
          Math.max(12, (word.rect[3] - word.rect[1]) * 2.5)
      ) {
        segments.push(segment);
        segment = [];
      }
      segment.push(word);
    }
    if (segment.length) segments.push(segment);
  }
  return segments.map((line) => {
    const x1 = Math.min(...line.map((word) => word.rect[0]));
    const top = Math.min(...line.map((word) => word.rect[1]));
    const x2 = Math.max(...line.map((word) => word.rect[2]));
    const bottom = Math.max(...line.map((word) => word.rect[3]));
    return [
      round(x1),
      round(candidate.pageHeight - bottom),
      round(x2),
      round(candidate.pageHeight - top),
    ];
  });
}

function reconstructedText(words: PageWord[]) {
  return words
    .map((word) => `${word.text}${word.spaceAfter ? " " : ""}`)
    .join("")
    .trim();
}

function isSkippableFigurePage(rawPage: unknown) {
  const {height, words} = pageWords(rawPage);
  const width = Number((rawPage as any)?.[0]) || 0;
  if (!height || !width) return false;
  const central = words.filter(word => word.rect[1] > height * 0.12 && word.rect[3] < height * 0.88 &&
    word.rect[0] > width * 0.06 && word.rect[2] < width * 0.94);
  if (!central.length) return true;
  const rows = new Map<number,string[]>();
  for (const word of central) rows.set(word.lineIndex,[...(rows.get(word.lineIndex) || []),word.text]);
  const lines = [...rows.values()].map(parts => parts.join(" ")
    .replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, letters => letters.replace(/\s/g, "")));
  const lengths = lines.map(line => (line.match(/[\p{L}]+/gu) || []).length);
  // Large multi-panel microscopy figures can exceed 160 label words without
  // containing prose. Require independent panel, scale-bar and statistical
  // evidence before raising that label budget; dense tables alone do not qualify.
  const microscopyPanels = lines.filter(line=>/^(?:[a-z]\s*){1,4}$/.test(line.trim())).length >= 4 &&
    lines.some(line=>/\b\d+\s*[µμ]m\b/u.test(line)) &&
    lines.filter(line=>/^P\s*[=<]/.test(line.trim())).length >= 4;
  // Figure panels often contain many short labels. Never skip a prose line,
  // complete textual sentence, dense table, or a page with unknown geometry.
  return lines.length >= 8 && lengths.every(length => length <= 6) &&
    lengths.reduce((sum,length)=>sum+length,0) <= (microscopyPanels ? 400 : 160) &&
    lengths.filter(length => length <= 3).length / lengths.length >= 0.8 &&
    !lines.some((line,index)=>lengths[index] >= 3 && /[.!?。！？]\s*$/.test(line));
}

function crossPageMatch(data: RecognizerData, query: string[]): GeometryMatch {
  // Require substantial exact text on BOTH adjacent pages. Do not use the
  // permissive token-window fallback here: it could join unrelated passages.
  const matches = new Map<string, GeometryMatch>();
  const pages = data.pages || [];
  const findPart = (page: unknown, index: number, text: string) => {
    const { height, words } = pageWords(page);
    const width = Number((page as any)?.[0]) || 0;
    return [words, wordsInColumnOrder(words, width)].flatMap((order) =>
      compactCharacterCandidates(
        order,
        index,
        height,
        text,
        "compact-character-sequence",
        query.length >= 20 ? 4 : 24,
      ),
    );
  };
  for (let pageIndex = 0; pageIndex + 1 < pages.length; pageIndex++) {
    // Most pages cannot contain the beginning. Avoid rebuilding every possible
    // long query split for those pages.
    const minimum = query.length >= 20 ? 3 : 8;
    if (!findPart(pages[pageIndex], pageIndex, query.slice(0, minimum).join(" ")).length) continue;
    let following = pageIndex + 1;
    // Skip at most two blank/margin-only or sparse-label figure pages.
    // The full query still has to match exactly across the retained pages.
    while (following + 1 < pages.length && following - pageIndex <= 2) {
      if (findPart(pages[following], following, query.slice(-8).join(" ")).length) break;
      if (!isSkippableFigurePage(pages[following])) break;
      following++;
    }
    for (let split = minimum; split <= query.length - minimum; split++) {
      const first = findPart(
        pages[pageIndex],
        pageIndex,
        query.slice(0, split).join(" "),
      );
      if (!first.length) continue;
      const second = findPart(
        pages[following],
        following,
        query.slice(split).join(" "),
      );
      for (const left of first) {
        for (const right of second) {
          // A short continuation is allowed only at a physical page edge;
          // the rest of this substantial sentence must still match exactly.
          if (split < 8 && Math.max(...left.words.map(w=>w.rect[3])) < left.pageHeight * 0.65) continue;
          if (query.length - split < 8 && Math.min(...right.words.map(w=>w.rect[1])) > right.pageHeight * 0.2) continue;
          const rects = rectsForCandidate(left);
          const nextPageRects = rectsForCandidate(right);
          const key = JSON.stringify({ pageIndex, following, rects, nextPageRects });
          matches.set(key, {
            status: "unique",
            occurrences: 1,
            pageIndex,
            pageLabel: String(pageIndex + 1),
            rects,
            ...(following === pageIndex + 1 ? { nextPageRects } : {
              additionalPages: [{ pageIndex: following, rects: nextPageRects,
                text: reconstructedText(right.words), offset: right.words[0]?.charOffset || 0,
                top: right.words[0]?.rect[1] || 0 }],
            }),
            text: `${reconstructedText(left.words)} ${reconstructedText(right.words)}`,
            score: 0.94,
            method: "cross-page-compact-character-sequence",
            offset: left.words[0]?.charOffset || 0,
            top: left.words[0]?.rect[1] || 0,
          });
        }
      }
    }
  }
  if (matches.size === 1) return matches.values().next().value!;
  // Never return writable geometry for ambiguous cross-page matches.
  return {
    status: matches.size ? "ambiguous" : "not-found",
    occurrences: matches.size,
  };
}

export function locateQuoteGeometry(
  data: RecognizerData,
  selector: TextQuoteSelector,
): GeometryMatch {
  const query = textTokens(selector.exact);
  const prefix = textTokens(selector.prefix || "");
  const suffix = textTokens(selector.suffix || "");
  if (!query.length) return { status: "not-found", occurrences: 0 };

  let rawCandidates = (data.pages || []).flatMap((page, pageIndex) =>
    candidatesForPage(page, pageIndex, query, prefix, suffix, selector.exact),
  );
  // Apply the same adjacent-context evidence to compact/column matches as to
  // token matches. Eight tokens alone are often identical in figure legends.
  const before = compactCharacters(selector.prefix || "").slice(-72);
  const after = compactCharacters(selector.suffix || "").slice(0,72);
  const heading = typeof selector.heading === "string" &&
    /^(?:extended\s+data\s+)?fig(?:ure)?\.?\s*\d+\b/i.test(selector.heading.trim())
    ? compactCharacters(selector.heading).slice(0,96) : "";
  for (const candidate of rawCandidates) {
    const page = data.pages![candidate.pageIndex];
    const {words} = pageWords(page);
    let evidence = 0;
    for (const ordered of [words, wordsInColumnOrder(words, Number((page as any)?.[0]) || 0)]) {
      const left = ordered.indexOf(candidate.words[0]), right = ordered.indexOf(candidate.words.at(-1)!);
      if (left < 0 || right < left) continue;
      const leading = compactCharacters(reconstructedText(ordered.slice(Math.max(0,left-50),left)));
      const trailing = compactCharacters(reconstructedText(ordered.slice(right+1,right+51)));
      evidence = Math.max(evidence,
        (before.length >= 16 && leading.endsWith(before) ? 0.5 : 0) +
        (after.length >= 16 && trailing.startsWith(after) ? 0.5 : 0));
    }
    // Do not compound the old short-token score: longer context is stronger.
    if (evidence) candidate.score = 2 + evidence;
    // Repeated legend sentences are disambiguated by the actual English
    // caption title captured before translation, never by the current page.
    if (heading.length >= 24 && compactIndex(words).text.includes(heading)) candidate.score += 4;
  }
  if (rawCandidates.some((candidate) => candidate.score >= 0.97)) {
    rawCandidates = rawCandidates.filter((candidate) => candidate.score >= 0.97);
  }
  rawCandidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.pageIndex - right.pageIndex ||
      left.startToken - right.startToken,
  );
  // The normal and column reading orders can find the same physical words.
  // Count distinct locations, not the number of matching strategies.
  const distinct = new Map<string, Candidate>();
  for (const candidate of rawCandidates) {
    const key = `${candidate.pageIndex}:${candidate.words
      .map((w) => w.wordIndex)
      .sort((a, b) => a - b)
      .join(",")}`;
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  let candidates = [...distinct.values()];
  // Use context only when one exact location has strictly stronger evidence.
  // Ties remain ambiguous and never return writable geometry.
  if (candidates[0]?.score > 1) {
    const bestScore = candidates[0].score;
    candidates = candidates.filter(
      (candidate) => candidate.score === bestScore,
    );
  }
  if (!candidates.length) return crossPageMatch(data, query);
  if (candidates.length > 1) {
    return { status: "ambiguous", occurrences: candidates.length };
  }

  const best = candidates[0];
  const firstWord = best.words[0];
  return {
    status: "unique",
    occurrences: candidates.length,
    pageIndex: best.pageIndex,
    pageLabel: String(best.pageIndex + 1),
    rects: rectsForCandidate(best),
    text: reconstructedText(best.words),
    score: best.score,
    method: best.method,
    offset: firstWord?.charOffset || 0,
    top: firstWord?.rect[1] || 0,
  };
}
