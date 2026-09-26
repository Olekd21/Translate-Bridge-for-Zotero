import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await fs.readFile(
  "packages/browser-extension/content.js",
  "utf8",
);
const helpers = source.slice(
  source.indexOf("  function normalizedReadableText("),
  source.indexOf("  function isPdfAnchorReady("),
);
const recovery = source.slice(
  source.indexOf("  async function fetchSourceParagraphs("),
  source.indexOf("  function translatedMappingCandidates("),
);
const english =
  "Lymphatic vessels protect cardiac function during pressure overload.";
const anchor = { containerId: "paper-paragraph" };

function harness({
  status = 200,
  title = "Paper",
  body = "",
  empty = false,
  pending = false,
  paragraphs = [{ id: "paper-paragraph", textContent: english }],
} = {}) {
  let requests = 0;
  let clock = 1000;
  let timeout;
  let signal;
  let clears = 0;
  const state = {
    sourceParagraphsPromise: null,
    sourceFetchRetryAt: 0,
    sourceFetchError: "",
  };
  const context = vm.createContext({
    state,
    AbortController,
    Error,
    Date: { now: () => clock },
    location: { href: "https://example.org/article" },
    textContainerSelector: "p",
    isTextContainer: () => true,
    setTimeout(fn, ms) {
      assert.equal(ms, 10000);
      timeout = fn;
      return 1;
    },
    clearTimeout() {
      clears++;
    },
    async fetch(_url, options) {
      requests++;
      signal = options.signal;
      if (pending)
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      return { status, ok: status === 200, text: async () => "fixture" };
    },
    DOMParser: class {
      parseFromString() {
        return {
          title,
          body: { textContent: body },
          querySelector: () => null,
          querySelectorAll: () => (empty ? [] : paragraphs),
        };
      }
    },
  });
  vm.runInContext(helpers + recovery, context);
  return {
    state,
    recover: context.recoverOriginalParagraph,
    count: () => requests,
    advance: () => {
      clock += 60001;
    },
    abort: () => timeout(),
    aborted: () => signal.aborted,
    clears: () => clears,
    navigate: (url) => { context.location.href = url; },
  };
}

test("successful concurrent lookups share one request and cache the source", async () => {
  const h = harness();
  assert.deepEqual(await Promise.all([h.recover(anchor), h.recover(anchor)]), [
    english,
    english,
  ]);
  assert.equal(await h.recover(anchor), english);
  assert.equal(h.count(), 1);
  assert.equal(h.clears(), 1);
});

for (const status of [403, 429]) {
  test(`HTTP ${status} pauses retries but leaves captured original text usable`, async () => {
    const h = harness({ status });
    await assert.rejects(h.recover(anchor), new RegExp(`HTTP ${status}`));
    await assert.rejects(h.recover(anchor), /暂停重新读取/);
    assert.equal(await h.recover({ originalParagraph: english }), english);
    assert.equal(h.count(), 1);
    h.advance();
    await assert.rejects(h.recover(anchor), new RegExp(`HTTP ${status}`));
    assert.equal(h.count(), 2);
  });
}

for (const fixture of [
  { title: "Checking your browser - reCAPTCHA" },
  {
    title: "",
    body: "Checking your browser before accessing pmc.ncbi.nlm.nih.gov",
  },
]) {
  test(`HTTP 200 verification page is rejected (${fixture.title || "body"})`, async () => {
    const h = harness(fixture);
    await assert.rejects(h.recover(anchor), /浏览器验证页/);
    assert.equal(h.state.sourceParagraphsPromise, null);
    await assert.rejects(h.recover(anchor), /浏览器验证页/);
    assert.equal(h.count(), 1);
  });
}

test("a hanging source request is actually aborted and retry is paused", async () => {
  const h = harness({ pending: true });
  const result = h.recover(anchor);
  h.abort();
  await assert.rejects(result, /超过 10 秒/);
  assert.equal(h.aborted(), true);
  assert.equal(h.clears(), 1);
  await assert.rejects(h.recover(anchor), /暂停重新读取/);
  assert.equal(h.count(), 1);
});

test("empty successful response is not cached as paper content", async () => {
  const h = harness({ empty: true });
  await assert.rejects(h.recover(anchor), /未返回可用的英文正文/);
  assert.equal(h.state.sourceParagraphsPromise, null);
});

test("source order changes do not affect stable-id recovery", async () => {
  const h = harness({
    paragraphs: [
      {
        id: "advert",
        textContent: "An unrelated announcement should never be a PDF anchor.",
      },
      { id: "paper-paragraph", textContent: english },
    ],
  });
  assert.equal(await h.recover({ ...anchor, containerIndex: 0 }), english);
});
test("index-only and duplicate-id recovery are refused", async () => {
  const h = harness();
  await assert.rejects(h.recover({ containerIndex: 0 }), /稳定段落标识/);
  assert.equal(h.count(), 0);
  const duplicate = harness({
    paragraphs: [
      { id: "paper-paragraph", textContent: english },
      { id: "paper-paragraph", textContent: english },
    ],
  });
  await assert.rejects(duplicate.recover(anchor), /重复/);
});
test("a different article cannot reuse the previous fetched source", async () => {
  const h=harness();
  await h.recover(anchor);
  h.navigate("https://example.org/another-article");
  await h.recover(anchor);
  assert.equal(h.count(),2);
  h.navigate("https://example.org/another-article#results");
  await h.recover(anchor);
  assert.equal(h.count(),2);
});
