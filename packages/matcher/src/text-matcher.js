const LIGATURES = new Map([
  ["\ufb00", "ff"],
  ["\ufb01", "fi"],
  ["\ufb02", "fl"],
  ["\ufb03", "ffi"],
  ["\ufb04", "ffl"],
]);

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\ufb00-\ufb04]/g, (character) => LIGATURES.get(character) || character)
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, "$1$2")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function contextScore(documentText, index, quoteLength, selector) {
  let score = 1;
  const prefix = normalizeText(selector.prefix);
  const suffix = normalizeText(selector.suffix);

  if (prefix) {
    const actualPrefix = normalizeText(
      documentText.slice(Math.max(0, index - prefix.length * 2 - 8), index),
    );
    if (actualPrefix.endsWith(prefix)) score += 0.5;
  }

  if (suffix) {
    const actualSuffix = normalizeText(
      documentText.slice(
        index + quoteLength,
        index + quoteLength + suffix.length * 2 + 8,
      ),
    );
    if (actualSuffix.startsWith(suffix)) score += 0.5;
  }

  return score;
}

function wordTokens(value) {
  const normalized = normalizeText(value);
  return Array.from(normalized.matchAll(/[\p{L}\p{N}]+/gu), (match) => ({
    value: match[0],
    index: match.index,
    end: match.index + match[0].length,
  }));
}

function sequenceStarts(tokens, sequence) {
  const starts = [];
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((value, offset) => tokens[index + offset].value === value)) {
      starts.push(index);
    }
  }
  return starts;
}

function findFragmentWindowCandidates(documentText, selector) {
  const documentTokens = wordTokens(documentText);
  const quoteTokens = wordTokens(selector.exact).map((token) => token.value);
  if (quoteTokens.length < 12) return [];

  const fragmentLength = Math.min(7, Math.floor(quoteTokens.length / 3));
  const leading = quoteTokens.slice(0, fragmentLength);
  const trailing = quoteTokens.slice(-fragmentLength);
  const leadingStarts = sequenceStarts(documentTokens, leading);
  const trailingStarts = sequenceStarts(documentTokens, trailing);
  const maxWindowTokens = quoteTokens.length + 16;
  const candidates = [];

  for (const start of leadingStarts) {
    const endStart = trailingStarts.find(
      (candidate) =>
        candidate >= start + fragmentLength && candidate - start <= maxWindowTokens,
    );
    if (endStart === undefined) continue;
    const first = documentTokens[start];
    const last = documentTokens[endStart + fragmentLength - 1];
    candidates.push({
      index: first.index,
      length: last.end - first.index,
      score: 0.75,
      method: "fragment-window",
    });
  }
  return candidates;
}

export function findTextCandidates(documentText, selector) {
  const normalizedDocument = normalizeText(documentText);
  const normalizedQuote = normalizeText(selector.exact);
  if (!normalizedQuote) return [];

  const candidates = [];
  let cursor = 0;
  while (cursor <= normalizedDocument.length - normalizedQuote.length) {
    const index = normalizedDocument.indexOf(normalizedQuote, cursor);
    if (index === -1) break;
    candidates.push({
      index,
      length: normalizedQuote.length,
      score: contextScore(normalizedDocument, index, normalizedQuote.length, selector),
      method: "exact-normalized",
    });
    cursor = index + Math.max(1, normalizedQuote.length);
  }

  if (!candidates.length) {
    candidates.push(...findFragmentWindowCandidates(documentText, selector));
  }

  return candidates.sort((left, right) => right.score - left.score || left.index - right.index);
}

export function pageForOffset(pageCharacterCounts, offset) {
  let cumulative = 0;
  for (let pageIndex = 0; pageIndex < pageCharacterCounts.length; pageIndex += 1) {
    cumulative += Number(pageCharacterCounts[pageIndex]) || 0;
    if (offset < cumulative) {
      return { pageIndex, pageLabel: String(pageIndex + 1), pageOffset: offset - (cumulative - pageCharacterCounts[pageIndex]) };
    }
  }
  return null;
}

export function locateQuote(documentText, pageCharacterCounts, selector) {
  const candidates = findTextCandidates(documentText, selector).map((candidate) => ({
    ...candidate,
    page: pageForOffset(pageCharacterCounts, candidate.index),
  }));

  return {
    status: candidates.length === 0 ? "not-found" : candidates.length === 1 ? "unique" : "ambiguous",
    candidates,
  };
}

export function locateQuoteInPages(pages, selector) {
  const candidates = pages.flatMap((page, pageIndex) =>
    findTextCandidates(page.text, selector).map((candidate) => ({
      ...candidate,
      page: {
        pageIndex,
        pageLabel: String(pageIndex + 1),
        pageOffset: candidate.index,
      },
    })),
  );

  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.page.pageIndex - right.page.pageIndex ||
      left.index - right.index,
  );

  return {
    status:
      candidates.length === 0
        ? "not-found"
        : candidates.length === 1
          ? "unique"
          : "ambiguous",
    candidates,
  };
}
