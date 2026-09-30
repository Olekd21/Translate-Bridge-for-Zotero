async(page)=>{
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 const result=await page.evaluate(async()=>{
 const wait=()=>new Promise(r=>setTimeout(r,100)); const passed=[];
 const english=['To identify such secreted factors, we performed mass spectrometry of the LEC-conditioned medium and identified 317 unique proteins.','From that list, we initially focused on all secreted proteins by comparing changes in their expression levels in the RNA-seq dataset described above.','Among these candidates, Reln was greatly reduced in Prox1 hearts (log2 fold change of -0.6098 compared to control).'];
 const chinese=['为了鉴定这些分泌因子，我们进行了质谱分析，鉴定出317种独特的蛋白质。','首先，我们通过比较上述RNA-seq数据集中这些蛋白质的表达水平变化，重点关注所有分泌蛋白。','在这些候选蛋白中，Reln在Prox1心脏中显著降低，与对照组相比变化为-0.6098。'];
 const p=document.createElement('p');p.textContent=english.join(' ');document.getElementById('paper').append(p);await wait();
 const spans=[...p.querySelectorAll('[data-pb-sentence]')]; if(spans.length!==3)throw Error('bad English fixture');
 spans[0].textContent=chinese[0];spans[1].textContent=chinese[1]+'在这些';spans[2].textContent=chinese[2].slice(3);delete globalThis.Translator;
 const select=async(a,start,b,end)=>{const r=document.createRange();r.setStart(a,start);r.setEnd(b,end);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();};
 const a=spans[1].firstChild,b=spans[2].firstChild;
 for(const [name,node,start,last,end,expected] of [
 ['first alone',a,0,a,chinese[1].length,english[1]],
 ['second alone',a,chinese[1].length,b,b.length,english[2]],
 ['pair',a,0,b,b.length,english.slice(1).join(' ')],
 ['previous plus first',spans[0].firstChild,0,a,chinese[1].length,english.slice(0,2).join(' ')]]){
 await select(node,start,last,end);
 if(document.querySelector('.pb-open-selection').disabled||document.querySelector('.pb-source').textContent!==expected)throw Error(name+': '+document.querySelector('.pb-source').textContent);passed.push(name);
 }
 await select(a,chinese[1].length,a,a.length);if(!document.querySelector('.pb-open-selection').disabled)throw Error('fragment accepted');passed.push('fragment rejected');
 await select(a,6,a,chinese[1].length);if(!document.querySelector('.pb-open-selection').disabled)throw Error('partial first accepted');passed.push('partial first rejected');
 return {passed};
 });if(errors.length)throw Error(errors.join('\n'));return {...result,errors};
}
