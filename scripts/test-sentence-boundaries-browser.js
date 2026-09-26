async (page) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  await page.route("**/*",route=>route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const data=await page.evaluate(async()=>(await fetch("/fixtures/aha-sentence-selection.json")).json());
  await page.evaluate(data=>{
    const p=document.createElement("p");p.id="identified-wrapper";
    const span=document.createElement("span");span.id="publisher-text-id";
    span.textContent=data.english.join(" ");p.append(span);document.getElementById("paper").append(p);
  },data);
  await page.waitForTimeout(100);
  const count=await page.locator("#identified-wrapper [data-pb-sentence]").count();
  if(count!==data.english.length)throw new Error(`English span with publisher ID: expected ${data.english.length} sentence anchors, got ${count}`);
  if(await page.locator("#publisher-text-id").count()!==1)throw new Error("Publisher ID duplicated");
  await page.evaluate(data=>{
    document.querySelectorAll("#identified-wrapper [data-pb-sentence]").forEach((span,i)=>{span.textContent=data.chinese[i];});
    delete globalThis.Translator;
    const spans=document.querySelectorAll("#identified-wrapper [data-pb-sentence]");
    const r=document.createRange();r.setStart(spans[0].firstChild,0);r.setEnd(spans[1].firstChild,spans[1].firstChild.length);
    getSelection().removeAllRanges();getSelection().addRange(r);
    spans[0].dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));
  },data);
  await page.waitForTimeout(80);await page.locator(".pb-selection-button").click();await page.waitForTimeout(100);
  const recovered=await page.locator(".pb-source").textContent();
  if(recovered!==data.english.slice(0,2).join(" "))throw new Error(`First two sentences failed: ${recovered}`);
  if(errors.length)throw new Error(errors.join("\n"));
  return {passed:true,recovered,errors,scope:"reconstructed DOM; publisher ID around English paragraph; first two sentences"};
}
