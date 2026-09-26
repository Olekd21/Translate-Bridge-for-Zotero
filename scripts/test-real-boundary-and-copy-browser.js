async(page)=>{
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.route("**/*",r=>r.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result=await page.evaluate(async()=>{
    const data=await(await fetch("/fixtures/aha-sentence-selection.json")).json();
    const english=data.english.slice(1,4).map(t=>t.replaceAll("Rev-nAAC","Rev‐nAAC"));
    const zh=data.chinese.slice(1,4), wait=()=>new Promise(r=>setTimeout(r,80)), passed=[];
    const p=document.createElement("p");p.id="real-rev-spill";p.textContent=english.join(" ");document.getElementById("paper").append(p);await wait();
    const spans=[...p.querySelectorAll("[data-pb-sentence]")];
    // Exact observed defect: the first Chinese marker ends with the next Rev.
    spans[0].textContent=zh[0]+"Rev";spans[1].textContent=" "+zh[1].slice(3);spans[2].textContent=zh[2];
    delete globalThis.Translator;
    const select=async(startNode,start,endNode,end)=>{
      const r=document.createRange();r.setStart(startNode,start);r.setEnd(endNode,end);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await wait();
      if(document.querySelector(".pb-panel").dataset.open!=="true")document.querySelector(".pb-selection-button").click();await wait();
    };
    const a=spans[0].firstChild,b=spans[1].firstChild;
    await select(a,0,a,zh[0].length);
    if(document.querySelector(".pb-source").textContent!==english[0])throw new Error("first sentence incorrectly includes next sentence");passed.push("exact first sentence with trailing Rev excluded");
    await select(a,zh[0].length,b,b.length);
    if(document.querySelector(".pb-source").textContent!==english[1])throw new Error("second sentence failed across marker edge");passed.push("exact second sentence starts in preceding marker");
    await select(a,0,b,b.length);
    if(document.querySelector(".pb-source").textContent!==english.slice(0,2).join(" "))throw new Error("pair not fully recovered");passed.push("both selected restores both English sentences");
    await select(a,0,a,a.length);
    if(!document.querySelector(".pb-sync").disabled)throw new Error("dangling Rev silently discarded");passed.push("incomplete next sentence rejected");
    await select(a,5,a,zh[0].length);
    if(!document.querySelector(".pb-sync").disabled)throw new Error("partial sentence expanded");passed.push("partial first sentence rejected");
    const copies=[];Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async value=>copies.push(JSON.parse(value))}});
    const button=document.querySelector(".pb-diagnostics"),detail=document.querySelector(".pb-boundary-details");
    button.click();await wait();const initial=copies[0].selectedCharacters;
    await select(b,0,b,b.length);
    if(button.textContent!=="复制定位诊断"||button.disabled)throw new Error("new selection did not reset copy UI");
    button.click();await wait();button.click();await wait();
    if(copies.length!==3||copies[1].selectedCharacters===initial||copies[2].selectedCharacters!==copies[1].selectedCharacters)throw new Error("repeat copy not refreshed");passed.push("new selection and repeated clicks copy fresh payloads");
    detail.click();await wait();await new Promise(r=>setTimeout(r,1900));
    if(button.textContent!=="复制定位诊断"||detail.textContent!=="复制边界详情（含当前句子）")throw new Error("copy feedback did not auto-reset");passed.push("both copy labels auto-reset");
    let resolveOld;navigator.clipboard.writeText=()=>new Promise(r=>resolveOld=r);button.click();await wait();
    await select(a,5,a,zh[0].length);resolveOld();await wait();
    if(button.textContent!=="复制定位诊断"||button.disabled)throw new Error("stale copy completion changed new selection");passed.push("old copy completion cannot overwrite new selection");
    return {passed};
  });
  if(errors.length)throw new Error(errors.join("\n"));return {...result,errors};
}
