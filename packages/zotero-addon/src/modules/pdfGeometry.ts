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
      .replace(/[−–]/g, "-")
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
function compactCharacters(value: string) {
  // Ignore explicit bracketed references, NOT scientific numbers/gene IDs.
  const raw = normalizeText(value)
    .replace(numericCitation, "")
    .replace(/[−–]/g, "-");
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

function compactIndex(words: PageWord[]) {
  const cached = compactCache.get(words);
  if (cached) return cached;
  let raw = "";
  const rawOwners: PageWord[] = [];
  for (const word of words) {
    const text =
      normalizeText(word.text).replace(/[−–]/g, "-") +
      (word.spaceAfter ? " " : "");
    raw += text;
    for (let i = 0; i < text.length; i++) rawOwners.push(word);
  }
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
  compactCache.set(words, result);
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

function compactCharacterCandidates(
  words: PageWord[],
  pageIndex: number,
  pageHeight: number,
  queryText: string,
  method: "compact-character-sequence" | "column-compact-character-sequence",
): Candidate[] {
  const query = compactCharacters(queryText);
  if (query.length < 24) return [];

  const { text: page, owners } = compactIndex(words);

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

  // Matching only the ends or skipping arbitrary middle words can turn a
  // negated/different claim into a writable highlight. Require the full text.
  return [];
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
      ),
    );
  };
  for (let pageIndex = 0; pageIndex + 1 < pages.length; pageIndex++) {
    for (let split = 8; split <= query.length - 8; split++) {
      const first = findPart(
        pages[pageIndex],
        pageIndex,
        query.slice(0, split).join(" "),
      );
      if (!first.length) continue;
      const second = findPart(
        pages[pageIndex + 1],
        pageIndex + 1,
        query.slice(split).join(" "),
      );
      for (const left of first) {
        for (const right of second) {
          const rects = rectsForCandidate(left);
          const nextPageRects = rectsForCandidate(right);
          const key = JSON.stringify({ pageIndex, rects, nextPageRects });
          matches.set(key, {
            status: "unique",
            occurrences: 1,
            pageIndex,
            pageLabel: String(pageIndex + 1),
            rects,
            nextPageRects,
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

  const rawCandidates = (data.pages || []).flatMap((page, pageIndex) =>
    candidatesForPage(page, pageIndex, query, prefix, suffix, selector.exact),
  );
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
