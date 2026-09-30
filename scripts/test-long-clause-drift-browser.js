async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 const result=await page.evaluate(async()=>{
 const wait=()=>new Promise(r=>setTimeout(r,90)),passed=[];
 const en=['The cardiac lymphatic system is a network of vessels in the heart that maintains fluid balance, removes waste products, contributes to immune surveillance and responds to inflammation and injury.','Although cardiac lymphatics remain understudied compared with those of other organs, recent studies have revealed important roles in cardiovascular disease.','Further research will clarify how these pathways regulate tissue recovery after injury.'];
 const zh=['心脏淋巴系统是心脏内的血管网络，负责维持体液平衡、清除代谢废物、参与免疫监视并对炎症和损伤做出反应。','尽管与其它器官的淋巴系统相比，心脏淋巴系统的研究仍然严重不足，但近期研究已经揭示其在心血管疾病中的重要作用。','进一步研究将阐明这些途径如何调控损伤后的组织恢复。'];
 const long='尽管与其它器官的淋巴系统相比，心脏淋巴系统的研究仍然严重不足';
 const select=async(p,a,start,b,end)=>{const r=document.createRange();r.setStart(a,start);r.setEnd(b,end);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();};
 delete globalThis.Translator;
 for(const chained of [false,true]){
 const p=document.createElement('p');p.textContent=en.join(' ');document.getElementById('paper').append(p);await wait();
 const s=[...p.querySelectorAll('[data-pb-sentence]')];if(s.length!==3)throw Error('fixture not captured');
 const secondTail=chained?'进一步研究将阐明这些途径如何调控':'';
 s[0].textContent=zh[0]+long;s[1].textContent=zh[1].slice(long.length)+secondTail;s[2].textContent=zh[2].slice(secondTail.length);
 const [a,b,c]=s.map(n=>n.firstChild);
 const cases=[['first',a,0,a,zh[0].length,en[0]],['second',a,zh[0].length,b,zh[1].length-long.length,en[1]],['first two',a,0,b,zh[1].length-long.length,en.slice(0,2).join(' ')],['whole',a,0,c,c.length,en.join(' ')]];
 if(chained)cases.push(['third',b,zh[1].length-long.length,c,c.length,en[2]]);
 for(const [name,n,start,last,end,expected] of cases){await select(p,n,start,last,end);if(document.querySelector('.pb-open-selection').disabled||document.querySelector('.pb-source').textContent!==expected)throw Error(name+' mismatch');passed.push((chained?'chain ':'single ')+name);}
  await select(p,a,0,c,c.length);
 let copied;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>copied=JSON.parse(text)}});
 document.querySelector('.pb-diagnostics').click();await wait();
 if(!copied.blocks.length||copied.originalSelectionLanguage!=='zh'||copied.language!=='en')throw Error('original diagnostics lost after mapping');
 if(JSON.stringify(copied).includes(en[0])||JSON.stringify(copied).includes(zh[0]))throw Error('ordinary diagnostic leaks article text');passed.push('mapped diagnostic retained without article text');
 await select(p,a,4,a,zh[0].length);if(!document.querySelector('.pb-open-selection').disabled)throw Error('partial expanded');passed.push('partial rejected');
 await select(p,a,zh[0].length,a,a.length);if(!document.querySelector('.pb-open-selection').disabled)throw Error('clause expanded');passed.push('unfinished clause rejected');
 }
 return {passed};
 });if(errors.length)throw Error(errors.join('\n'));return {...result,errors};
}
