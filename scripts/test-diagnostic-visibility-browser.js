async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 await page.addStyleTag({url:'http://127.0.0.1:18841/packages/browser-extension/content.css'});
 return await page.evaluate(async()=>{
 const wait=()=>new Promise(r=>setTimeout(r,120)),passed=[];
 const buttons=[...document.querySelectorAll('.pb-diagnostics,.pb-boundary-details')];
 const visible=()=>buttons.every(b=>!b.hidden&&getComputedStyle(b).display!=='none');
 const hidden=()=>buttons.every(b=>b.hidden&&getComputedStyle(b).display==='none');
 if(!hidden())throw Error('initial visible');passed.push('initial hidden with real CSS');
 const p=document.createElement('p');p.textContent='The treatment improved cardiac function after recovery from injury. Independent experiments confirmed the effect in all measured tissues.';document.getElementById('paper').append(p);await wait();
 const spans=[...p.querySelectorAll('[data-pb-sentence]')];spans[0].textContent='治疗改善了损伤恢复后的心脏功能。';spans[1].textContent='独立实验验证了测量组织中的效果。';delete globalThis.Translator;
 const select=async(start)=>{const n=spans[0].firstChild,r=document.createRange();r.setStart(n,start);r.setEnd(n,n.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();};
 await select(0);if(!hidden())throw Error('success visible');passed.push('successful match hidden');
 await select(3);if(!visible())throw Error('failure hidden');passed.push('failed match visible');
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});buttons[0].click();await wait();if(!visible())throw Error('copy changes visibility');passed.push('copy stays available during error');
 await select(0);if(!hidden())throw Error('error persists after success');passed.push('new successful selection hides both');
 return {passed};
 });
}
