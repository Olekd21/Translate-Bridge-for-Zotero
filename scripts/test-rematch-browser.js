async (page) => {
  const url = "http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html";
  const zh = [
    "左心室流出道梗阻常导致儿童患者出现病理性心室重塑，而手术解除压力负荷则可触发逆向重塑并带来终身康复。为了模拟幼年时期的这一过程，我们在出生24小时内的小鼠中建立了Rev-nAAC模型，使用具有独特水解动力学的可吸收缝线。",
    "缝线在约4周时损失了75%的初始抗拉强度。",
    "采用这种简化的手术方法，手术成功率为96%，12周存活率为86.7%。",
  ];
  const passed = [];
  const anchors = [];
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  const reset = async () => {
    await page.goto(url);
    return await page.locator("#paper > .NLM_p, #p-result-3").allTextContents();
  };
  const select = async (first, last = first) => {
    await page.evaluate(({ first, last }) => {
      const range = document.createRange();
      range.setStartBefore(document.getElementById(first));
      range.setEndAfter(document.getElementById(last));
      const selection = getSelection();selection.removeAllRanges();selection.addRange(range);
      document.getElementById(first).dispatchEvent(new MouseEvent("mouseup", {bubbles:true}));
    }, { first, last });
    await page.waitForTimeout(80);
    if (await page.locator(".pb-panel").getAttribute("data-open") !== "true")
      await page.locator(".pb-selection-button").click();
    await page.waitForTimeout(120);
  };
  const verify = async (expected, name) => {
    const result = await page.locator(".pb-source").textContent();
    if (result !== expected) throw new Error(`${name}: wrong English: ${result}`);
    passed.push(name);
    anchors.push({name,exact:result,translation:await page.locator(".pb-translation").textContent()});
  };
  let english = await reset();
  await page.evaluate(zh => zh.forEach((text, i) => {
    document.getElementById(`p-result-${i+1}`).innerHTML = `<font><font>${text}</font></font>`;
  }), zh);
  await select("p-result-1");await verify(english[0], "div paragraph after Google-style wrappers");
  await select("p-result-2");await verify(english[1], "numeric sentence preserved");
  await select("p-result-3");await verify(english[2], "ordinary p paragraph");
  await select("p-result-1", "p-result-3");await verify(english.join(" "), "cross-block range clipped and assembled");
  english = await reset();
  await page.evaluate(zh => {
    const old = document.getElementById("p-result-1");
    const replacement = document.createElement("div");replacement.id=old.id;replacement.textContent=zh;
    old.replaceWith(replacement);
  }, zh[0]);
  await select("p-result-1");await verify(english[0], "replaced DOM node recovered by unique stable id");
  english = await reset();
  await page.evaluate(zh => { const p=document.getElementById("p-result-2");p.removeAttribute("id");p.setAttribute("data-test","no-id");p.firstChild.data=zh; }, zh[1]);
  // Select the id-less element without manufacturing a recovery id.
  await page.evaluate(() => {const p=document.querySelector('[data-test="no-id"]');const r=document.createRange();r.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));});
  await page.waitForTimeout(80);await page.locator(".pb-selection-button").click();await page.waitForTimeout(100);
  await verify(english[1], "id-less div recovered from pretranslation cache");
  english = await reset();
  await page.evaluate(zh => {
    document.getElementById("p-result-3").innerHTML=`<div><font>${zh}</font></div>`;
  },zh[2]);
  await select("p-result-3");await verify(english[2],"div translation wrapper inside semantic paragraph");

  // Load the extension only after translation; recovering by ID must survive
  // a new banner that shifts document-order indexes.
  await page.route("**/packages/browser-extension/content.js",route=>route.fulfill({body:"",contentType:"text/javascript"}));
  await page.goto(url);
  await page.evaluate(zh=>{
    document.getElementById("p-result-1").textContent=zh;
    const banner=document.createElement("p");banner.textContent="新增公告";document.body.prepend(banner);
  },zh[0]);
  await page.unroute("**/packages/browser-extension/content.js");
  await page.addScriptTag({url:"http://127.0.0.1:18841/packages/browser-extension/content.js"});
  await select("p-result-1");await verify(english[0],"late injection recovers by ID despite shifted indexes");

  english=await reset();
  const sentence=english[0].slice(0,english[0].indexOf(". ")+1);
  const selectedZh=zh[0].slice(0,zh[0].indexOf("为了"));
  await page.evaluate(({zh,sentence,selectedZh})=>{
    document.getElementById("p-result-1").textContent=zh;
    globalThis.Translator={availability:async()=>"available",create:async()=>({translate:async text=>text===sentence?selectedZh:"不相干的译文"})};
    const p=document.getElementById("p-result-1"),r=document.createRange();
    r.setStart(p.firstChild,0);r.setEnd(p.firstChild,selectedZh.length);
    getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
  },{zh:zh[0],sentence,selectedZh});
  await page.waitForTimeout(80);await page.locator(".pb-selection-button").click();await page.waitForTimeout(120);
  await verify(sentence,"partial sentence uses verified translation without expanding to whole paragraph");
  if(errors.length)throw new Error(errors.join("\n"));
  return {passed,anchors,errors,scope:"real Chromium DOM; mocked Chrome APIs; reconstructed AHA markup"};
}
