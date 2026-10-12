async page => {
  const results=await page.evaluate(async()=>{
    const audit=__pbAudit,results=[];
    for(const expected of __auditSource){
      const el=document.querySelector(`[data-audit-block="${expected.id}"]`);
      const full=document.createRange();full.selectNodeContents(el);
      const inspect=async(range,label)=>{
        const start=performance.now();
        const a=audit.buildAnchor({rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>range.toString()});
        const parts=a?.parts||[a];
        let mapped=null,confirmed=null,error=null;
        // 只接受已核验原文；不能让模拟后端或备选翻译器补全测试。
        if(parts.every(p=>p?.capturedSentenceSource)){try{mapped=await audit.mapTranslatedSelection(a);}catch(e){error=String(e);}}
        if(!mapped && parts.every(p=>p?.capturedSentenceSource||p?.sourceSentenceProposal)){try{confirmed=await audit.mapTranslatedSelection({...a,useSourceSentenceScope:true});}catch(e){error=String(e);}}
        return {label,text:range.toString(),source:mapped?.exact||'',confirmed:confirmed?.exact||'',method:mapped?.mappingMethod||null,error,proposal:parts.some(p=>p?.sourceSentenceProposal)?parts.map(p=>p.sourceSentenceProposal?.source||p.capturedSentenceSource||'').join(' '):'',diagnostic:parts.map(p=>p?.sentenceDiagnostic),elapsed:performance.now()-start};
      };
      const whole=await inspect(full,'paragraph'),text=full.toString();
      const sentences=[];const matches=[...text.matchAll(/[^。！？]+[。！？]+[”’」』）)\]]*/gu)];
      for(const m of text.matchAll(/[^。！？]+[。！？]+[”’」』）)\]]*/gu))sentences.push(await inspect(audit.sliceTextRange(full,m.index,m.index+m[0].length),`sentence-${sentences.length}`));
      const pairs=[];for(let i=0;i<matches.length-1;i++)pairs.push(await inspect(audit.sliceTextRange(full,matches[i].index,matches[i+1].index+matches[i+1][0].length),`pair-${i}`));
      const sourceUnits=[];
      for(const saved of expected.sentences){
        const spans=[...el.querySelectorAll(`[data-pb-sentence="${saved.key}"]`)];
        if(!spans.length){sourceUnits.push({key:saved.key,source:'',error:'missing'});continue;}
        const r=document.createRange();r.setStartBefore(spans[0]);r.setEndAfter(spans.at(-1));
        sourceUnits.push({...await inspect(r,`source-${saved.key}`),key:saved.key,expected:saved.text});
      }
      results.push({id:expected.id,whole,sentences,pairs,sourceUnits,expected,html:el.outerHTML});
    }
    return results;
  });
  page._nativeResults=results;
  const data={capture:page._nativeCapture,untranslated:page._untranslated,results};
  const pending=page.waitForEvent('download');
  await page.evaluate(data=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='native-google-final.json';a.click();},data);
  await(await pending).saveAs('E:/CodexProjects/ChatGPT/文献解读/.cache/vegfc155/native-google-final.json');
  const units=results.flatMap(p=>p.sourceUnits),sentences=results.flatMap(p=>p.sentences);
  return {paragraphs:results.length,paragraphPass:results.filter(p=>p.whole.source===p.expected.text).length,sourceUnits:units.length,sourceUnitPass:units.filter(s=>s.source===s.expected).length,chineseSentences:sentences.length,chineseSentencePass:sentences.filter(s=>s.source).length,confirmedSentences:sentences.filter(s=>s.confirmed).length,pairs:results.reduce((n,p)=>n+p.pairs.length,0),pairPass:results.reduce((n,p)=>n+p.pairs.filter(s=>s.source||s.confirmed).length,0),failures:sentences.filter(s=>!s.source&&!s.confirmed).slice(0,5).map(s=>({text:s.text.slice(0,80),reason:s.diagnostic?.map(d=>d.reason),proposal:!!s.proposal})),maxSelectionMs:Math.max(...results.flatMap(p=>[p.whole,...p.sentences,...p.sourceUnits]).map(s=>s.elapsed||0))};
}
