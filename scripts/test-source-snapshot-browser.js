export default async page => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result = await page.evaluate(async () => {
    const wait = (ms = 120) => new Promise(resolve => setTimeout(resolve, ms));
    const initialParagraph = document.getElementById("p-result-1");
    if (!initialParagraph?.dataset.pbParagraph ||
        !initialParagraph.querySelector("[data-pb-sentence]"))
      throw new Error("DOMContentLoaded source capture did not complete");
    const english = [
      "The heart has a complex network of lymphatic vessels that is essential for cardiac function. 6,7",
      "Several lymphatic markers are highly expressed in lymphatic vessels.",
      "VEGFR-3 signaling supports lymphatic development and maintenance.",
    ];
    const chinese = [
      "心脏拥有复杂的淋巴管网络，该网络对于维持心脏功能至关重要。",
      "已鉴定出多种淋巴标志物，这些标志物在淋巴管中高表达。",
      "VEGFR-3信号通路支持淋巴管的发育和维持。",
    ];
    let paragraph = document.createElement("p");
    paragraph.id = "immutable-source-paragraph";
    paragraph.textContent = english.join(" ");
    document.getElementById("paper").append(paragraph);
    await wait();
    const originalSpans = [...paragraph.querySelectorAll("[data-pb-sentence]")];
    if (originalSpans.length !== english.length)
      throw new Error(`source sentence count ${originalSpans.length}`);
    const originalKeys = originalSpans.map(span => span.dataset.pbSentence);
    const paragraphId = paragraph.dataset.pbParagraph;
    if (!paragraphId) throw new Error("stable paragraph identity missing");

    // Google can temporarily leave an all-Latin, incomplete intermediate DOM.
    // It must never overwrite the already captured source paragraph.
    originalSpans[0].textContent = "Temporary translator staging text remains incomplete and must not become source.";
    await wait();

    // Replace the whole paragraph, remove its paragraph attribute, split the
    // visible translation into many repeated physical marker fragments and add
    // enough empty clones to reproduce the reported anchor inflation.
    const translated = paragraph.cloneNode(false);
    translated.removeAttribute("data-pb-paragraph");
    const addFragment = (key, text, tag = "span") => {
      const node = document.createElement("span");
      node.dataset.pbSentence = key;
      if (tag === "sup") {
        const sup = document.createElement("sup");
        sup.textContent = text;
        node.append(sup);
      } else node.textContent = text;
      translated.append(node);
    };
    addFragment(originalKeys[0], chinese[0]);
    addFragment(originalKeys[0], "6,7", "sup");
    for (let i = 0; i < 33; i++) addFragment(originalKeys[0], "");
    addFragment(originalKeys[1], "已");
    addFragment(originalKeys[1], chinese[1].slice(1));
    for (let i = 0; i < 31; i++) addFragment(originalKeys[1], "");
    addFragment(originalKeys[2], "VEGFR-3");
    addFragment(originalKeys[2], chinese[2].slice("VEGFR-3".length));
    for (let i = 0; i < 31; i++) addFragment(originalKeys[2], "");
    paragraph.replaceWith(translated);
    paragraph = translated;
    await wait(180);

    const physical = paragraph.querySelectorAll("[data-pb-sentence]").length;
    const logical = new Set([...paragraph.querySelectorAll("[data-pb-sentence]")]
      .map(span => span.dataset.pbSentence)).size;
    if (physical < 100 || logical !== english.length)
      throw new Error(`fragment accounting physical=${physical}, logical=${logical}`);

    const select = async range => {
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      await wait();
      if (document.querySelector(".pb-panel").dataset.open !== "true")
        document.querySelector(".pb-selection-button").click();
      await wait();
    };
    const whole = document.createRange();
    whole.selectNodeContents(paragraph);
    await select(whole);
    const recovered = document.querySelector(".pb-source").textContent;
    if (recovered !== english.join(" "))
      throw new Error(`immutable source recovery failed: ${document.querySelector(".pb-status").textContent}`);

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async value => { globalThis.snapshotDiagnostic = value; },
    }});
    const partialNode = paragraph.querySelectorAll(`[data-pb-sentence="${originalKeys[1]}"]`)[1].firstChild;
    const partialRange = document.createRange();
    partialRange.setStart(partialNode, 2);
    partialRange.setEnd(partialNode, Math.min(10, partialNode.length));
    await select(partialRange);
    document.querySelector(".pb-boundary-details").click();
    await wait(20);
    const mainDiagnostic = JSON.parse(globalThis.snapshotDiagnostic).blocks?.[0];
    if (mainDiagnostic?.sentenceAnchors !== english.length ||
        mainDiagnostic?.sourceSentenceAnchors !== english.length ||
        mainDiagnostic?.physicalSentenceFragments !== physical)
      throw new Error(`logical diagnostic counts failed: ${JSON.stringify(mainDiagnostic)}`);

    // A copied subset in an unrelated paragraph has no complete paragraph
    // identity and must not borrow the full source sentence.
    const foreign = document.createElement("p");
    foreign.append(paragraph.querySelectorAll(`[data-pb-sentence="${originalKeys[1]}"]`)[1].cloneNode(true));
    document.getElementById("paper").append(foreign);
    await wait();
    const foreignRange = document.createRange();
    foreignRange.selectNodeContents(foreign);
    await select(foreignRange);
    if (!document.querySelector(".pb-open-selection").disabled)
      throw new Error("partial foreign projection was accepted");

    // Diagnostics distinguish logical source sentences from physical clones.
    document.querySelector(".pb-boundary-details").click();
    await wait(20);
    const diagnostic = JSON.parse(globalThis.snapshotDiagnostic);
    const block = diagnostic.blocks?.[0];
    return {
      recovered,
      physical,
      logical,
      sourceSentenceAnchors: mainDiagnostic?.sourceSentenceAnchors,
      physicalSentenceFragments: mainDiagnostic?.physicalSentenceFragments,
      foreignReason: block?.reason,
    };
  });
  if (errors.length) throw new Error(errors.join("\n"));
  if (result.sourceSentenceAnchors !== 3 || result.physicalSentenceFragments !== 101 ||
      result.foreignReason === "captured")
    throw new Error(`foreign diagnostic was not isolated: ${JSON.stringify(result)}`);
  return {
    ...result,
    passed: [
      "initial English is captured only after the source DOM is complete",
      "immutable English snapshot survives Latin-only intermediate mutation",
      "whole-paragraph replacement is adopted without physical marker uniqueness",
      "100+ physical fragments remain three logical source sentences",
      "partial copied marker set is rejected",
    ],
    errors,
  };
}
