async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 return await page.evaluate(async()=>{
 const wait=()=>new Promise(r=>setTimeout(r,120));
 const en1='Cluster 2 exhibited a general upregulation trend throughout the process, mainly related to autophagy and mitophagy, which are considered beneficial in cardiovascular diseases.';
 const en2='Cluster 3 was rapidly upregulated at 6 weeks and then declined quickly, associated with the T cell‐related pathway.';
 const en3='Cluster 4 was rapidly upregulated at 4 weeks and then downregulated, mainly enriched in neutrophil extracellular trap formation.';
 const zh='基因簇2在整个过程中呈现普遍上调的趋势，主要与自噬和线粒体自噬相关，而自噬和线粒体自噬被认为对心血管疾病有益。';
 const p=document.createElement('p');p.innerHTML=en1+'<sup><a href="#ref22">22</a>, <a href="#ref23">23</a>, <a href="#ref24">24</a></sup> '+en2+' '+en3;document.getElementById('paper').append(p);await wait();
 const spans=[...p.querySelectorAll('[data-pb-sentence]')];
 if(spans.length!==3)throw Error('citation segmentation '+spans.length);
 spans[0].innerHTML=zh+'<sup><a href="#ref22">22</a>、<a href="#ref23">23</a>、<a href="#ref24">24</a></sup>';
 spans[1].textContent='簇3在6周时迅速上调，随后快速下降，与T细胞相关通路有关。';
 spans[2].textContent='簇4在4周时迅速上调，随后下调，主要富集于中性粒细胞胞外陷阱形成。';
 delete globalThis.Translator;
 const r=document.createRange();r.setStart(spans[0].firstChild,0);r.setEnd(spans[0].firstChild,zh.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();document.querySelector('.pb-selection-button').click();await wait();
 const source=document.querySelector('.pb-source').textContent;
 if(!source.includes(en1)||source.includes('Cluster 3'))throw Error('incorrect English '+source);
 if(document.querySelector('.pb-open-selection').disabled)throw Error('not enabled');
  const mixed=zh+'22、23、24簇3在6周时迅速上调，随后快速下降，与T细胞相关通路有关。簇4在4周时迅速上调，随后下调，主要富集于中性粒细胞胞外陷阱形成';
 spans[0].textContent=mixed;
 const choose=async()=>{const r=document.createRange();r.setStart(spans[0].firstChild,0);r.setEnd(spans[0].firstChild,zh.length);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();};
 await choose();
 if(!document.querySelector('.pb-open-selection').disabled)throw Error('mixed marker guessed without verification');
 const verified=[];
 globalThis.Translator={availability:async()=> 'available',create:async()=>({translate:async text=>{verified.push(text);return text===en1+'22, 23, 24'?zh:'不同的句子内容';}})};
 await choose(); await wait();
 if(document.querySelector('.pb-open-selection').disabled)throw Error('verified candidate unavailable');
 if(!verified.includes(en1+'22, 23, 24'))throw Error('first sentence candidate missing');
 return {passed:['citation sentence segmentation','reference exclusion','mixed marker rejected without verification','mock translator verified independent first-sentence candidate'],source};
 });
}
