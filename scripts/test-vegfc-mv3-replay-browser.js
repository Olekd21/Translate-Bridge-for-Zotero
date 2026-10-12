async page => {
  const data=await(await page.request.get('http://127.0.0.1:18841/.cache/vegfc155/native-google-final.json')).json();
  const url='https://pmc.ncbi.nlm.nih.gov/articles/PMC7989711/';
  await page.unrouteAll();
  await page.route(url,r=>r.fulfill({path:'E:/CodexProjects/ChatGPT/文献解读/.cache/vegfc155/pmc-replay.html',contentType:'text/html'}));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-audit-block="47"] [data-pb-sentence]');
  const setup=await page.evaluate(rows=>{
    let units=0;
    const norm=x=>x.replace(/\s+/g,' ').trim();
    for(const row of rows){
      const p=document.querySelector(`[data-audit-block="${row.id}"]`),markers=[...p.querySelectorAll('[data-pb-sentence]')];
      if(markers.length!==row.expected.sentences.length)throw Error(`marker count ${row.id}`);
      const keys={};
      for(let i=0;i<markers.length;i++){
        if(norm(markers[i].textContent)!==row.expected.sentences[i].text)throw Error(`original differs ${row.id}/${i}`);
        keys[row.expected.sentences[i].key]=markers[i].dataset.pbSentence;
      }
      const holder=document.createElement('div');holder.innerHTML=row.html;
      for(const m of holder.querySelectorAll('[data-pb-sentence]')){
        const key=keys[m.dataset.pbSentence];if(!key)throw Error('foreign recorded marker');m.dataset.pbSentence=key;
      }
      p.replaceChildren(...holder.firstElementChild.childNodes);units+=markers.length;
    }
    return {paragraphs:rows.length,units,mainWorldInjected:Boolean(window.__paperBridgeVersion),rootCount:document.querySelectorAll('#paper-bridge-root').length};
  },data.results);
  if(setup.mainWorldInjected||setup.rootCount!==1)throw Error('MV3 must be the only extension injection');
  const result=await page.evaluate(async rows=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const norm=s=>s.replace(/\s+/g,' ').trim();
    const point=(el,at)=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(at<=n.length)return[n,at];at-=n.length;}throw Error('offset missing');};
    const failures=[],passed=[],times=[];
    for(const row of rows){
      const p=document.querySelector(`[data-audit-block="${row.id}"]`),text=p.textContent;
      const matches=[...text.matchAll(/[^。！？]+[。！？]+[”’」』）)\]]*/gu)];
      const cases=[{...row.whole,start:0,end:text.length},...row.sentences.map((s,i)=>({...s,start:matches[i].index,end:matches[i].index+matches[i][0].length}))];
      for(const c of cases){
        const start=performance.now(),r=document.createRange();r.setStart(...point(p,c.start));r.setEnd(...point(p,c.end));
        getSelection().removeAllRanges();getSelection().addRange(r);
        p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait(30);
        if(document.querySelector('.pb-panel').dataset.open!=='true'){document.querySelector('.pb-selection-button').click();await wait(30);}
        if(c.confirmed){
          const proposal=document.querySelector('.pb-scope-proposal');
          if(proposal.hidden){failures.push({id:row.id,label:c.label,error:'proposal missing'});continue;}
          if(!document.querySelector('.pb-open-selection').disabled){failures.push({id:row.id,label:c.label,error:'unconfirmed scope enabled'});continue;}
          document.querySelector('.pb-use-source-sentence').click();await wait(30);
        }
        const expected=c.source||c.confirmed,actual=document.querySelector('.pb-source').textContent;
        if(!expected||norm(actual)!==norm(expected)||document.querySelector('.pb-open-selection').disabled)failures.push({id:row.id,label:c.label,error:'source or ready state',expected,actual,status:document.querySelector('.pb-status').textContent});
        else passed.push({id:row.id,label:c.label,confirmed:!!c.confirmed});
        times.push(performance.now()-start);
      }
    }
    return {total:passed.length+failures.length,passed:passed.length,confirmed:passed.filter(p=>p.confirmed).length,failures,maxMs:Math.max(...times)};
  },data.results);
  const pending=page.waitForEvent('download');await page.evaluate(x=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(x,null,2)]));a.download='mv3-replay.json';a.click();},{setup,...result});await(await pending).saveAs('E:/CodexProjects/ChatGPT/文献解读/.cache/vegfc155/mv3-replay.json');
  return {setup,...result,failures:result.failures.slice(0,3)};
}
