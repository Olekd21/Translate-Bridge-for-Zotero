async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 await page.addStyleTag({url:'http://127.0.0.1:18841/packages/browser-extension/content.css'});
 const results=[];
 for(const height of [900,600]) {
  await page.setViewportSize({width:1280,height});
  results.push(await page.evaluate(async()=>{
   document.querySelector('.pb-panel').dataset.open='true';
   const details=document.querySelector('.pb-saved-section details');details.open=true;
   const list=document.querySelector('.pb-saved-list');list.replaceChildren();
   for(let i=0;i<30;i++){const p=document.createElement('p');p.textContent='Article annotation '+i;p.style.height='40px';list.append(p);}
   const reading=document.querySelector('.pb-reading-scroll');reading.append(Object.assign(document.createElement('div'),{textContent:'Reading content'}));reading.lastChild.style.minHeight='1200px';
   const top=details.querySelector('summary').getBoundingClientRect().top;
   const scroll=document.querySelector('.pb-saved-content');scroll.scrollTop=500;reading.scrollTop=500;
   await new Promise(r=>setTimeout(r,250));
   if(Math.abs(top-details.querySelector('summary').getBoundingClientRect().top)>1)throw Error('Summary scrolled out');
   if(scroll.scrollTop===0)throw Error('Annotation list is not independently scrollable');
   if(document.querySelector('.pb-dock').getBoundingClientRect().bottom>innerHeight+1)throw Error('Dock clipped by fixed header');
   details.open=false;
   if(details.querySelector('summary').getBoundingClientRect().top<0)throw Error('Collapsed control inaccessible');
   return {height:innerHeight,fixedSummary:true,independentScroll:true,dockVisible:true};
  }));
 }
 return results;
}
