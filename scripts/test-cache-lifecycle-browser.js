async(page)=>{
  const errors=[];page.on("pageerror",e=>errors.push(String(e)));
  await page.route("**/*",r=>r.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result=await page.evaluate(async()=>{
    const data=await(await fetch("/fixtures/aha-sentence-selection.json")).json();
    const wait=()=>new Promise(r=>setTimeout(r,30));
    const passed=[];
    for(const scenario of ["whole-paragraph-clone","idless-paragraph-clone","stale-english-markers","incremental-translation"]){
      let p=document.createElement("p");if(scenario!=="idless-paragraph-clone")p.id=scenario;
      if(scenario==="stale-english-markers"){
        const span=document.createElement("span");span.dataset.pbSentence="previous-script-key";span.textContent=data.english.join(" ");p.append(span);
      }else p.textContent=data.english.join(" ");
      document.getElementById("paper").append(p);await wait();
      const spans=[...p.querySelectorAll("[data-pb-sentence]")];
      if(spans.length!==6)throw new Error(`${scenario}: missing sentence anchors`);
      for(let i=0;i<spans.length;i++){
        const font=document.createElement("font");font.textContent=data.chinese[i];spans[i].replaceChildren(font);
        if(scenario==="incremental-translation")await wait();
      }
      await wait();
      if(scenario.includes("clone")){const clone=p.cloneNode(true);p.replaceWith(clone);p=clone;await wait();}
      const current=p.querySelectorAll("[data-pb-sentence]");const range=document.createRange();range.setStartBefore(current[0]);range.setEndAfter(current[1]);
      getSelection().removeAllRanges();getSelection().addRange(range);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await wait();
      if(document.querySelector(".pb-panel").dataset.open!=="true")document.querySelector(".pb-selection-button").click();await wait();
      if(document.querySelector(".pb-source").textContent!==data.english.slice(0,2).join(" "))throw new Error(`${scenario}: ${document.querySelector('.pb-status').textContent}`);
      passed.push(scenario);
    }
    return {passed};
  });
  if(errors.length)throw new Error(errors.join("\n"));
  return {...result,errors};
}
