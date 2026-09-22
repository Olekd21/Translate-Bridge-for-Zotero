export type TextQuoteSelector = {
  type: "TextQuoteSelector";
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type PageMatch = {
  status: "unique" | "ambiguous" | "not-found";
  pageIndex?: number;
  pageLabel?: string;
  occurrences: number;
  score?: number;
};

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function pageSlices(text: string, pageChars?: number[]): string[] {
  if (!Array.isArray(pageChars) || !pageChars.length) return [text];
  const pages: string[] = [];
  let offset = 0;
  for (const rawCount of pageChars) {
    const count = Math.max(0, Number(rawCount) || 0);
    pages.push(text.slice(offset, offset + count));
    offset += count;
  }
  if (offset < text.length) pages[pages.length - 1] += text.slice(offset);
  return pages;
}

function contextScore(
  page: string,
  index: number,
  quoteLength: number,
  selector: TextQuoteSelector,
) {
  let score = 1;
  const prefix = normalizeText(selector.prefix);
  const suffix = normalizeText(selector.suffix);
  if (
    prefix &&
    normalizeText(
      page.slice(Math.max(0, index - prefix.length * 2 - 8), index),
    ).endsWith(prefix)
  )
    score += 0.5;
  if (
    suffix &&
    normalizeText(
      page.slice(
        index + quoteLength,
        index + quoteLength + suffix.length * 2 + 8,
      ),
    ).startsWith(suffix)
  )
    score += 0.5;
  return score;
}

type WordToken = { value: string; index: number; end: number };

function wordTokens(value: string): WordToken[] {
  const normalized = normalizeText(value);
  return Array.from(normalized.matchAll(/[\p{L}\p{N}]+/gu), (match) => ({
    value: match[0],
    index: match.index || 0,
    end: (match.index || 0) + match[0].length,
  }));
}

function sequenceStarts(tokens: WordToken[], sequence: string[]): number[] {
  const starts: number[] = [];
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (
      sequence.every((value, offset) => tokens[index + offset].value === value)
    )
      starts.push(index);
  }
  return starts;
}

function fragmentWindowMatches(page: string, selector: TextQuoteSelector) {
  const tokens = wordTokens(page);
  const quoteTokens = wordTokens(selector.exact).map((token) => token.value);
  if (quoteTokens.length < 12) return [];
  const fragmentLength = Math.min(7, Math.floor(quoteTokens.length / 3));
  const leadingStarts = sequenceStarts(
    tokens,
    quoteTokens.slice(0, fragmentLength),
  );
  const trailingStarts = sequenceStarts(
    tokens,
    quoteTokens.slice(-fragmentLength),
  );
  const maxWindowTokens = quoteTokens.length + 16;

  return leadingStarts.flatMap((start) => {
    const endStart = trailingStarts.find(
      (candidate) =>
        candidate >= start + fragmentLength &&
        candidate - start <= maxWindowTokens,
    );
    if (endStart === undefined) return [];
    return [
      {
        index: tokens[start].index,
        length: tokens[endStart + fragmentLength - 1].end - tokens[start].index,
        score: 0.75,
      },
    ];
  });
}

export function locateQuoteInPages(
  text: string,
  pageChars: number[] | undefined,
  selector: TextQuoteSelector,
): PageMatch {
  const quote = normalizeText(selector.exact);
  if (!quote) return { status: "not-found", occurrences: 0 };

  const matches: Array<{ pageIndex: number; score: number }> = [];
  pageSlices(text, pageChars).forEach((rawPage, pageIndex) => {
    const page = normalizeText(rawPage);
    const pageMatches: Array<{ index: number; length: number; score: number }> =
      [];
    let cursor = 0;
    while (cursor <= page.length - quote.length) {
      const index = page.indexOf(quote, cursor);
      if (index === -1) break;
      pageMatches.push({
        index,
        length: quote.length,
        score: contextScore(page, index, quote.length, selector),
      });
      cursor = index + Math.max(1, quote.length);
    }
    if (!pageMatches.length) {
      pageMatches.push(...fragmentWindowMatches(page, selector));
    }
    matches.push(
      ...pageMatches.map((match) => ({
        pageIndex,
        score: match.score,
      })),
    );
  });

  matches.sort(
    (left, right) =>
      right.score - left.score || left.pageIndex - right.pageIndex,
  );
  if (!matches.length) return { status: "not-found", occurrences: 0 };
  return {
    status: matches.length === 1 ? "unique" : "ambiguous",
    pageIndex: matches[0].pageIndex,
    pageLabel: String(matches[0].pageIndex + 1),
    occurrences: matches.length,
    score: matches[0].score,
  };
}
