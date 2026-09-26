async (page) => {
  const errors=[];
  page.on("pageerror",error=>errors.push(String(error)));
  await page.route("**/*",r=>r.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result = await page.evaluate(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const data=await (await fetch("/fixtures/aha-sentence-selection.json")).json();
    const failures=[], counts={}, cases=[], corpusBlocks=[];
    const variants=["plain","div","outer-id","nested-id","sentence-id","italic","links","superscript","linebreaks","clone"];
    for(const variant of variants){
      const p=document.createElement(variant==="div"?"div":"p");p.id=`matrix-${variant}`;
      let host=p;
      if(variant==="outer-id"||variant==="nested-id"){
        host=document.createElement("span");host.id=`host-${variant}`;p.append(host);
        if(variant==="nested-id"){const inner=document.createElement("em");inner.id="nested-inner";host.append(inner);host=inner;}
      }
      data.english.forEach((text,i)=>{
        if(["sentence-id","italic","links","superscript"].includes(variant)){
          const el=document.createElement({"sentence-id":"span",italic:"i",links:"a",superscript:"sup"}[variant]);
          el.id=`${variant}-${i}`;el.textContent=text;host.append(el);
        }else host.append(document.createTextNode(text));
        if(i<data.english.length-1)host.append(document.createTextNode(variant==="linebreaks"?"\n\t":" "));
      });
      document.getElementById("paper").append(p);await sleep(15);
      const spans=[...p.querySelectorAll("[data-pb-sentence]")];
      if(spans.length!==data.english.length){failures.push({variant,type:"capture",expected:6,actual:spans.length});continue;}
      if(p.textContent.replace(/\s+/g," ").trim()!==data.english.join(" "))failures.push({variant,type:"text-mutation"});
      spans.forEach((span,i)=>{
        const font=document.createElement("font");font.textContent=data.chinese[i];span.replaceChildren(font);
        if(variant==="clone")span.replaceWith(span.cloneNode(true));
      });
      for(let start=0;start<6;start++)for(let end=start;end<6;end++)cases.push({id:p.id,variant,start,end,expected:data.english.slice(start,end+1).join(" ")});
    }
    const domains=["osa","nature","bert","dropout","climate","psychology","ligo","geometry-review"];
    for(const domain of domains){
      const rows=await (await fetch(`/.cache/corpus-audit/${domain}-cases.json`)).json();
      let paragraphs=0;
      const eligible=rows.filter(row=>{
        const text=row.selector?.exact?.replace(/\s+/g," ").trim()||"";
        const sentences=[...new Intl.Segmenter("en",{granularity:"sentence"}).segment(text)].map(p=>p.segment.trim());
        return sentences.length>=3&&sentences.length<=10&&sentences.every(s=>s.length>=20)&&!/[\u3400-\u9fff]/.test(text);
      });
      const sample=[...new Set(Array.from({length:Math.min(5,eligible.length)},(_,i)=>Math.round(i*(eligible.length-1)/Math.max(1,Math.min(5,eligible.length)-1))))].map(i=>eligible[i]);
      for(const row of sample){
        const text=row.selector?.exact?.replace(/\s+/g," ").trim()||"";
        const sentences=[...new Intl.Segmenter("en",{granularity:"sentence"}).segment(text)].map(p=>p.segment.trim());
        if(sentences.length<3||sentences.length>10||sentences.some(s=>s.length<20)||/[\u3400-\u9fff]/.test(text))continue;
        const p=document.createElement("p");p.id=`corpus-${domain}-${paragraphs}`;p.textContent=sentences.join(" ");document.getElementById("paper").append(p);await sleep(15);
        const spans=[...p.querySelectorAll("[data-pb-sentence]")];
        if(spans.length!==sentences.length){failures.push({variant:domain,type:"corpus-capture",expected:sentences.length,actual:spans.length});continue;}
        spans.forEach((span,i)=>span.textContent=`这是用于验证节点对应的中文占位测试句子第${i+1}句。`);
        corpusBlocks.push({paper:domain,id:row.id,pageIndex:row.expectedPageIndex,sentences:sentences.length});
        for(let i=0;i<sentences.length;i++)cases.push({id:p.id,variant:domain,start:i,end:i,expected:sentences[i]});
        if(++paragraphs>=5)break;
      }
      counts[domain+"-paragraphs"]=paragraphs;
    }
    delete globalThis.Translator;
    for(const c of cases){
      const p=document.getElementById(c.id), spans=p.querySelectorAll("[data-pb-sentence]");
      const r=document.createRange();r.setStartBefore(spans[c.start]);r.setEndAfter(spans[c.end]);
      getSelection().removeAllRanges();getSelection().addRange(r);
      p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await sleep(8);
      if(document.querySelector(".pb-panel").dataset.open!=="true")document.querySelector(".pb-selection-button").click();
      await sleep(8);
      const actual=document.querySelector(".pb-source").textContent;
      counts[c.variant]=(counts[c.variant]||0)+1;
      if(actual!==c.expected)failures.push({...c,type:"selection",actual,status:document.querySelector(".pb-status").textContent});
    }
    // Independent semantic boundaries for a mixed scientific paragraph.
    const formula=document.createElement("p");formula.id="matrix-formula";
    formula.innerHTML='The energy was described by <math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math> in this experiment. The measured ratio was 1.25 with a 95% confidence interval. Values were normalized to controls (<a id="formula-ref" href="#refs">Figure 2A</a>).';
    const formulaText=formula.textContent;document.getElementById("paper").append(formula);await sleep(15);
    const formulaSpans=[...formula.querySelectorAll("[data-pb-sentence]")];
    if(formulaSpans.length!==3||formula.textContent!==formulaText||document.querySelectorAll("#formula-ref").length!==1)failures.push({type:"formula-capture",actual:formulaSpans.length});
    else {
      const originals=formulaSpans.map(s=>s.textContent.trim());
      formulaSpans.forEach((s,i)=>s.textContent=["本实验采用能量公式。","测得比值为1.25，并给出95%置信区间。","数值相对对照进行了归一化（图2A）。"][i]);
      for(let i=0;i<3;i++){
        const r=document.createRange();r.selectNodeContents(formulaSpans[i]);getSelection().removeAllRanges();getSelection().addRange(r);formula.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await sleep(20);
        if(document.querySelector(".pb-source").textContent!==originals[i])failures.push({type:"formula-selection",i});
      }
      counts.formula=3;
    }
    // Replacement recovery must reject duplicate keys and copied foreign keys.
    for(const mode of ["duplicate-key","foreign-paragraph"]){
      const original=document.querySelector('#matrix-plain [data-pb-sentence]');
      const p=mode==="duplicate-key"?document.getElementById("matrix-plain"):document.createElement("p");
      if(mode==="foreign-paragraph"){p.id="matrix-foreign";p.textContent=data.english.join(" ");document.getElementById("paper").append(p);await sleep(15);p.replaceChildren();}
      const copy=original.cloneNode(true);
      if(mode==="duplicate-key"){original.replaceWith(copy);copy.after(copy.cloneNode(true));}else p.append(copy);
      const r=document.createRange();r.selectNodeContents(copy);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}));await sleep(20);
      if(!document.querySelector(".pb-sync").disabled)failures.push({type:"unsafe-recovery",mode});
      counts[mode]=1;
    }
    return {total:cases.length+(counts.formula||0)+2,failures,counts,corpusBlocks,scope:"DOM binding matrix. AHA screenshot translations; other domains use Chinese placeholders, NOT semantic translation or live Google tests."};
  });
  return {...result,errors};
}
