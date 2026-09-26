async (page) => {
  const errors = [];
  const passed = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/*", r => r.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const data = await page.evaluate(async () => (await fetch("/fixtures/aha-sentence-selection.json")).json());
  await page.evaluate(data => {
    const p = document.createElement("p");
    p.id = "screenshot-paragraph";
    p.textContent = data.english.join(" ");
    document.getElementById("paper").append(p);
  }, data);
  await page.waitForTimeout(100);
  const before = await page.locator("#screenshot-paragraph").textContent();
  if (before !== data.english.join(" ")) throw new Error("Instrumentation changed English text");
  const count = await page.locator("#screenshot-paragraph > [data-pb-sentence]").count();
  if (count !== data.english.length) throw new Error(`Sentence count ${count}`);
  await page.evaluate(data => {
    // Preserve parent spans, replace contents as browser translation can do.
    [...document.querySelectorAll("#screenshot-paragraph > [data-pb-sentence]")].forEach((span, i) => {
      const font = document.createElement("font");
      font.textContent = data.chinese[i];
      span.replaceChildren(font);
    });
    delete globalThis.Translator; // Must work without a second translation engine.
  }, data);
  const select = async (start, end, partial = false, id = "screenshot-paragraph") => {
    await page.evaluate(({start,end,partial,id}) => {
      const spans = document.querySelectorAll(`#${id} > [data-pb-sentence]`);
      const r = document.createRange();
      r.setStart(spans[start].firstChild.firstChild, partial ? 6 : 0);
      const text = spans[end].firstChild.firstChild;
      r.setEnd(text, text.length);
      getSelection().removeAllRanges();getSelection().addRange(r);
      spans[start].dispatchEvent(new MouseEvent("mouseup", {bubbles:true}));
    }, {start,end,partial,id});
    await page.waitForTimeout(80);
    if (await page.locator(".pb-panel").getAttribute("data-open") !== "true") await page.locator(".pb-selection-button").click();
    await page.waitForTimeout(100);
  };
  for (const [start,end,label] of [[1,4,"screenshot four middle sentences"],...data.english.map((_,i)=>[i,i,`single sentence ${i+1}`])]) {
    await select(start,end);
    const actual = await page.locator(".pb-source").textContent();
    if(actual !== data.english.slice(start,end+1).join(" ")) throw new Error(`${label}: ${actual}`);
    passed.push(label);
  }
  await select(2,2,true);
  if (!await page.locator(".pb-sync").isDisabled()) throw new Error("Partial clause silently expanded");
  passed.push("partial clause never silently expanded");
  const inlineText = await page.evaluate(() => {
    const p=document.createElement("div");p.id="inline-paragraph";
    p.innerHTML='The cardiac function was measured after surgery. The <i>Rev-nAAC</i> group recovered by 8 weeks (<a id="citation-test" href="#reference-test">Figure 2A</a>). The control group remained unchanged.';
    document.getElementById("paper").append(p);return p.textContent;
  });
  await page.waitForTimeout(100);
  if (await page.locator("#inline-paragraph").textContent() !== inlineText || await page.locator("#citation-test").count() !== 1)
    throw new Error("Inline citation or text altered by sentence capture");
  const inlineEnglish=await page.locator("#inline-paragraph > [data-pb-sentence]").allTextContents();
  if(inlineEnglish.length!==3)throw new Error("Inline sentence boundaries missing");
  await page.evaluate(() => {
    const zh=["手术后测量了心脏功能。","Rev-nAAC组在8周时恢复（图2A）。","对照组保持不变。"];
    document.querySelectorAll("#inline-paragraph > [data-pb-sentence]").forEach((span,i)=>{
      const font=document.createElement("font");font.textContent=zh[i];span.replaceChildren(font);
    });
  });
  for(let i=0;i<3;i++){
    await select(i,i,false,"inline-paragraph");
    if(await page.locator(".pb-source").textContent()!==inlineEnglish[i].trim())throw new Error(`Inline sentence ${i+1} mismatch`);
    passed.push(`inline citation paragraph sentence ${i+1}`);
  }
  if(errors.length)throw new Error(errors.join("\n"));
  return {passed,errors,scope:"real Chromium DOM, reconstructed Google-style mutation; no Translator API"};
}
