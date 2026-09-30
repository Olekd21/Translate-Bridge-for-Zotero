async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 return await page.evaluate(async()=>{
  const wait=()=>new Promise(r=>setTimeout(r,180));
  const en=['The cardiac lymphatic network maintains fluid balance and responds to injury60.',
    'Endothelial cells contribute to immune surveillance and clear metabolic waste.',
    'Further investigation is needed to establish the molecular mechanisms.'];
  const p=document.createElement('p');p.innerHTML=en[0].replace('60','<sup><a href="#ref60">60</a></sup>')+' '+en.slice(1).join(' ');
  document.getElementById('paper').append(p);await wait();
  const s=[...p.querySelectorAll('[data-pb-sentence]')];if(s.length!==3)throw Error('expected 3');
  s[0].textContent='心脏淋巴网络维持体液平衡并对损伤作出反应。';s[1].textContent='内皮细胞参与免疫监视并清除代谢废物。';s[2].textContent='需要进一步研究相关分子机制。';
  const ref=document.createElement('sup');ref.innerHTML='<a href="#ref60">60</a>';s[0].after(ref);delete globalThis.Translator;
  async function choose(){const r=document.createRange();r.setStartBefore(s[0]);r.setEndAfter(s[1]);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();}
  await choose();const expected=en.slice(0,2).join(' ');
  if(document.querySelector('.pb-source').textContent!==expected||document.querySelector('.pb-open-selection').disabled)throw Error('detached reference rejected');
  const passed=['reference link outside sentence markers matches without losing original citation'];
  ref.replaceWith(document.createTextNode('60'));await choose();
  if(!document.querySelector('.pb-open-selection').disabled)throw Error('unlinked number ignored');passed.push('unlinked numbers remain protected');
  p.childNodes.forEach(node=>{if(node.nodeType===3&&node.textContent==='60')node.remove();});
  const extra=document.createTextNode('额外的实验结果');s[0].after(extra);await choose();
  if(!document.querySelector('.pb-open-selection').disabled)throw Error('uncovered prose ignored');
  let report;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async x=>report=JSON.parse(x)}});
  document.querySelector('.pb-boundary-details').click();await wait();
  if(report.blocks[0].reason!=='uncovered-selection-text'||!report.blocks[0].boundary.unmarkedText.includes('额外的实验结果'))throw Error('missing actual gap');
  document.querySelector('.pb-diagnostics').click();await wait();
  if(JSON.stringify(report).includes('额外的实验结果'))throw Error('ordinary diagnostic leaks text');
  passed.push('uncovered prose refused and detailed report records it','ordinary diagnostic excludes selected and uncovered text');
  return {passed};
 });
}
