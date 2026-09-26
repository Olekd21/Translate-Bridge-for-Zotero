async(page)=>{
  await page.route("**/*",r=>r.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  return await page.evaluate(async()=>{
    const d=await(await fetch("/fixtures/aha-sentence-selection.json")).json();
    const wait=()=>new Promise(r=>setTimeout(r,60));
    const p=document.createElement("p");p.id="regrouping-probe";p.textContent=d.english.slice(1,4).join(" ");document.getElementById("paper").append(p);await wait();
    const spans=p.querySelectorAll("[data-pb-sentence]");
    // Hypothesis probe only: model a translator moving two translations into
    // the first source span. This is NOT observed real Google DOM evidence.
    spans[0].textContent=d.chinese[1]+d.chinese[2];spans[1].textContent="";spans[2].textContent=d.chinese[3];
    delete globalThis.Translator;
    Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async t=>{globalThis.probeDiagnostic=JSON.parse(t);}}});
    const results=[];
    for(const [label,start,end] of [["first",0,d.chinese[1].length],["second",d.chinese[1].length,spans[0].textContent.length],["pair",0,spans[0].textContent.length]]){
      const r=document.createRange();r.setStart(spans[0].firstChild,start);r.setEnd(spans[0].firstChild,end);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await wait();
      if(document.querySelector(".pb-panel").dataset.open!=="true")document.querySelector(".pb-selection-button").click();await wait();
      const details=document.querySelector(".pb-boundary-details");
      if(!details.hidden){details.click();await wait();}
      results.push({label,source:document.querySelector(".pb-source").textContent,syncEnabled:!document.querySelector(".pb-sync").disabled,diagnostic:details.hidden?null:globalThis.probeDiagnostic});
    }
    return {scope:"Hypothetical translation regrouping; not the user's captured DOM",expectedPairEnglish:d.english.slice(1,3).join(" "),results};
  });
}
