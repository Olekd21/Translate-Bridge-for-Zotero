async page => {
  // This uses Chrome's native Google translation, not a synthetic Chinese fixture.
  const url='https://pmc.ncbi.nlm.nih.gov/articles/PMC7989711/';
  page._translateContexts=[];const cdp=await page.context().newCDPSession(page);page._cdp=cdp;
  cdp.on('Runtime.executionContextCreated',e=>page._translateContexts.push(e.context));await cdp.send('Runtime.enable');
  await page.route(url,route=>route.fulfill({path:'E:/CodexProjects/ChatGPT/文献解读/.cache/vegfc155/pmc-instrumented.html',contentType:'text/html'}));
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.__pbAudit));
  const capture=await page.evaluate(()=>{
    window.__auditSource=[...document.querySelectorAll('[data-audit-block]')].map(p=>{
      const saved=__pbAudit.sourceParagraphSnapshot(p);
      return {id:p.dataset.auditBlock,text:saved?.text||p.textContent,sentences:saved?.sentences.map(s=>({key:s.key,text:s.text,start:s.sourceStart,end:s.sourceEnd}))||[],markers:p.querySelectorAll('[data-pb-sentence]').length};
    });
    return {paragraphs:__auditSource.length,sentences:__auditSource.reduce((n,p)=>n+p.sentences.length,0),unmarked:__auditSource.filter(p=>p.markers!==p.sentences.length||!p.markers).map(p=>({id:p.id,sentences:p.sentences.length,markers:p.markers}))};
  });
  page._nativeCapture=capture;
  return capture;
}
