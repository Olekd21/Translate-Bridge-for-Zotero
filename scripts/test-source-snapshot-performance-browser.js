export default async page => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const started = performance.now();
    const host = document.createElement("section");
    host.id = "snapshot-load-host";
    const paragraphCount = 200;
    for (let index = 0; index < paragraphCount; index++) {
      const paragraph = document.createElement("p");
      paragraph.id = `snapshot-load-${index}`;
      paragraph.textContent = `Cardiac lymphatic function remained stable in sample ${index}. ` +
        `VEGFR-3 expression was measured independently in sample ${index}. ` +
        `The corresponding control retained normal tissue fluid balance in sample ${index}.`;
      host.append(paragraph);
    }
    document.getElementById("paper").append(host);
    const expectedMarkers = paragraphCount * 3;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (host.querySelectorAll("[data-pb-sentence]").length === expectedMarkers) break;
      await wait(25);
    }
    const initialMarkers = [...host.querySelectorAll("[data-pb-sentence]")];
    const initialKeys = new Set(initialMarkers.map(span => span.dataset.pbSentence));
    const paragraphIds = new Set([...host.querySelectorAll("p")].map(p => p.dataset.pbParagraph));
    if (initialMarkers.length !== expectedMarkers || initialKeys.size !== expectedMarkers ||
        paragraphIds.size !== paragraphCount || paragraphIds.has(undefined))
      throw new Error(`initial capture mismatch markers=${initialMarkers.length} keys=${initialKeys.size} paragraphs=${paragraphIds.size}`);

    let target = document.getElementById("snapshot-load-100");
    const expectedSource = target.textContent;
    [...target.querySelectorAll("[data-pb-sentence]")].forEach((span, index) => {
      span.textContent = [
        "样本100的心脏淋巴功能保持稳定。",
        "在样本100中独立测量了VEGFR-3表达。",
        "相应对照在样本100中保持正常的组织液平衡。",
      ][index];
    });
    // Repeated asynchronous whole-paragraph replacements model progressive
    // Google DOM reconstruction. They must update only the projection.
    for (let index = 0; index < 25; index++) {
      const clone = target.cloneNode(true);
      if (index % 2) clone.removeAttribute("data-pb-paragraph");
      target.replaceWith(clone);
      target = clone;
      await wait(0);
    }
    await wait(50);
    const finalMarkers = [...host.querySelectorAll("[data-pb-sentence]")];
    const finalKeys = new Set(finalMarkers.map(span => span.dataset.pbSentence));
    if (finalMarkers.length !== expectedMarkers || finalKeys.size !== expectedMarkers)
      throw new Error(`source identities grew after translation markers=${finalMarkers.length} keys=${finalKeys.size}`);

    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await wait(80);
    if (document.querySelector(".pb-panel").dataset.open !== "true")
      document.querySelector(".pb-selection-button").click();
    await wait(80);
    const recovered = document.querySelector(".pb-source").textContent;
    if (recovered !== expectedSource)
      throw new Error(`repeated replacement lost immutable source: ${document.querySelector(".pb-status").textContent}`);
    return {
      paragraphCount,
      sourceSentences: initialKeys.size,
      physicalFragments: finalMarkers.length,
      elapsedMs: Math.round(performance.now() - started),
      recovered: recovered === expectedSource,
    };
  });
  if (errors.length) throw new Error(errors.join("\n"));
  if (result.elapsedMs > 5000) throw new Error(`source projection regression took ${result.elapsedMs}ms`);
  return {
    ...result,
    passed: [
      "200 paragraphs captured once with 600 stable source sentences",
      "25 asynchronous whole-paragraph replacements create no new source identities",
      "final translated paragraph still recovers its initial English snapshot",
    ],
    errors,
  };
}
