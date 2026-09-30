async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 return await page.evaluate(async()=>{
 const wait=()=>new Promise(r=>setTimeout(r,100));const p=document.createElement('p');
 p.textContent='The cardiac lymphatic network maintains fluid balance in the heart. Although the network remains understudied, research is expanding. Further studies are needed to establish the relevant mechanisms.';
 document.getElementById('paper').append(p);await wait();const s=[...p.querySelectorAll('[data-pb-sentence]')];
 s[0].textContent='心脏淋巴网络维持心脏中的体液平衡。尽管这一网络的研究仍然不足';s[1].textContent='但是相关研究正在扩展';s[2].textContent='需要更多研究来确定相关机制。';delete globalThis.Translator;
 const select=async()=>{const r=document.createRange();r.setStart(s[0].firstChild,0);r.setEnd(s[0].firstChild,19);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();};
 let copy;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async x=>copy=JSON.parse(x)}});
 await select();document.querySelector('.pb-boundary-details').click();await wait();
 let b=copy.blocks[0].boundary;if(!b.neighboringMarkers.length||!b.repairBlockers.includes('next-chinese-not-single-sentence'))throw Error('missing blocker');
 document.querySelector('.pb-diagnostics').click();await wait();if(JSON.stringify(copy).includes('understudied')||copy.blocks[0].boundary)throw Error('ordinary diagnostic includes text');
 const old=s[0], clone=old.cloneNode(true);clone.dataset.pbSentence='unknown-key';old.replaceWith(clone);s[0]=clone;await select();
 document.querySelector('.pb-boundary-details').click();await wait();b=copy.blocks[0].boundary;
 if(copy.blocks[0].reason!=='sentence-cache-missing'||!b.repairBlockers.includes('current-cache-invalid')||b.neighboringMarkers[0].keyExists)throw Error('cache diagnostic missing');
 return {passed:['adjacent text and exact stopping condition recorded','ordinary diagnostic excludes all neighboring text','missing cache identifies invalid marker and valid neighbors']};
 });
}
