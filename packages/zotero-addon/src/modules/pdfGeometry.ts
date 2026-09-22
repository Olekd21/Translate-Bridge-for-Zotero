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

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function textTokens(value: string): string[] {
  return Array.from(
    normalizeText(value).matchAll(/[\p{L}\p{N}]+/gu),
    (match) => match[0],
  );
}

function isRecognizerWord(value: unknown): value is RecognizerWord {
  return (
    Array.isArray(value) &&
    value.length >= 14 &&
    value.slice(0, 4).every((part) => typeof part === "number") &&
    typeof value[13] === "string"
  );
}

function pageWords(rawPage: unknown): { height: number; words: PageWord[] } {
  if (!Array.isArray(rawPage)) return { height: 0, words: [] };
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
  return { height, words };
}

function pageTokens(words: PageWord[]): PageToken[] {
  return words.flatMap((word) =>
    textTokens(word.text).map((value) => ({ value, word })),
  );
}

function compactCharacters(value: string) {
  // Numeric citation styles differ between HTML and PDF text layers
  // (for example 11,12,13,14 versus 11-14). Long fallback matches remain
  // distinctive after removing numbers, while gene names still retain letters.
  return normalizeText(value).replace(/[^\p{L}]+/gu, "");
}

function wordsInColumnOrder(words: PageWord[], pageWidth: number) {
  const lines = new Map<number, PageWord[]>();
  for (const word of words) {
    const line = lines.get(word.lineIndex) || [];
    line.push(word);
    lines.set(word.lineIndex, line);
  }
  const middle = pageWidth / 2;
  return Array.from(lines.values())
    .map((line) => ({
      line,
      column:
        line.reduce((sum, word) => sum + (word.rect[0] + word.rect[2]) / 2, 0) /
          line.length <
        middle
          ? 0
          : 1,
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

  let page = "";
  const owners: PageWord[] = [];
  for (const word of words) {
    const compact = compactCharacters(word.text);
    page += compact;
    owners.push(...Array.from(compact, () => word));
  }

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

function uniqueWords(tokens: PageToken[], start: number, end: number) {
  const words: PageWord[] = [];
  let previous = -1;
  for (let index = start; index <= end; index += 1) {
    const word = tokens[index].word;
    if (word.wordIndex !== previous) words.push(word);
    previous = word.wordIndex;
  }
  return words;
}

function candidatesForPage(
  rawPage: unknown,
  pageIndex: number,
  query: string[],
  prefix: string[],
  suffix: string[],
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
      words: uniqueWords(tokens, startToken, endToken),
      pageHeight: height,
    };
  });
  if (exact.length || query.length < 12) return exact;

  const queryText = query.join(" ");
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

  const maxExtraTokens = Math.max(16, Math.ceil(query.length / 2));
  const ordered: Candidate[] = [];
  for (let startToken = 0; startToken < tokens.length; startToken += 1) {
    if (tokens[startToken].value !== query[0]) continue;
    let pageCursor = startToken;
    let queryCursor = 0;
    while (
      pageCursor < tokens.length &&
      queryCursor < query.length &&
      pageCursor - startToken <= query.length + maxExtraTokens
    ) {
      let consumedPageTokens = 0;
      for (let width = 1; width <= 3; width += 1) {
        const joined = tokens
          .slice(pageCursor, pageCursor + width)
          .map((token) => token.value)
          .join("");
        if (joined === query[queryCursor]) {
          consumedPageTokens = width;
          break;
        }
      }
      if (consumedPageTokens) {
        queryCursor += 1;
        pageCursor += consumedPageTokens;
      } else {
        pageCursor += 1;
      }
    }
    if (queryCursor === query.length) {
      const endToken = pageCursor - 1;
      const extraTokens = endToken - startToken + 1 - query.length;
      ordered.push({
        pageIndex,
        startToken,
        endToken,
        score: 0.9 - extraTokens * 0.005,
        method: "ordered-token-window" as const,
        words: uniqueWords(tokens, startToken, endToken),
        pageHeight: height,
      });
    }
  }
  if (ordered.length) return ordered;

  const fragmentLength = Math.min(7, Math.floor(query.length / 3));
  const leading = sequenceStarts(tokens, query.slice(0, fragmentLength));
  const trailing = sequenceStarts(tokens, query.slice(-fragmentLength));
  const maxWindowTokens = query.length + 16;
  const fallback: Candidate[] = [];
  for (const startToken of leading) {
    for (const trailingStart of trailing) {
      if (
        trailingStart < startToken + fragmentLength ||
        trailingStart - startToken > maxWindowTokens
      ) {
        continue;
      }
      const endToken = trailingStart + fragmentLength - 1;
      fallback.push({
        pageIndex,
        startToken,
        endToken,
        score: 0.75,
        method: "fragment-window",
        words: uniqueWords(tokens, startToken, endToken),
        pageHeight: height,
      });
      break;
    }
  }
  return fallback;
}

function rectsForCandidate(candidate: Candidate): Rect[] {
  const grouped = new Map<number, PageWord[]>();
  for (const word of candidate.words) {
    const line = grouped.get(word.lineIndex) || [];
    line.push(word);
    grouped.set(word.lineIndex, line);
  }

  return Array.from(grouped.values()).map((line) => {
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
    candidatesForPage(page, pageIndex, query, prefix, suffix),
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
  const candidates = [...distinct.values()];
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
