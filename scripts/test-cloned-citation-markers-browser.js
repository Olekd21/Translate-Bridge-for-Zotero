async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 return await page.evaluate(async()=>{
  const wait=()=>new Promise(r=>setTimeout(r,160));
  const en=['Recent experimental studies have investigated cardiac lymphatic dysfunction in human hearts.',
   'One notable example is a single-nucleus RNA-seq analysis, in which non-ischaemic left ventricular samples from patients with end-stage ischaemic cardiomyopathy were compared with samples from non-failing hearts (organ donation)60.',
   'A higher yield of LECs in failing than non-failing hearts was reported, a finding supported by increased densities of CCL21-expressing LECs in fibrotic areas, as observed using in situ hybridization.'];
  const p=document.createElement('p');p.textContent=en.join(' ');document.getElementById('paper').append(p);await wait();
  const s=[...p.querySelectorAll('[data-pb-sentence]')];if(s.length!==3)throw Error('fixture segmentation');
  const chinese='例子是一项单核RNA测序分析，该分析比较了终末期缺血性心肌病患者的非缺血性左心室样本与来自非衰竭心脏（器官捐献）的样本';
  s[0].textContent='近期实验研究调查了人类心脏的心脏淋巴功能障碍。';s[1].textContent=chinese;s[2].textContent='研究发现衰竭心脏中淋巴内皮细胞的数量增加，原位杂交支持这一发现。';
  const reference=document.createElement('sup');const link=document.createElement('a');link.href='#ref-60';
  const ref=s[0].cloneNode(false);ref.textContent='60';link.append(ref);reference.append(link);
  const empty=s[1].cloneNode(false), stop=s[1].cloneNode(false);stop.textContent='。';
  s[1].after(reference,empty,stop);delete globalThis.Translator;
  async function select(first,last,whole=false){const r=document.createRange();if(whole)r.selectNodeContents(p);else{r.setStartBefore(first);r.setEndAfter(last);}getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();await wait();return document.querySelector('.pb-source').textContent;}
  const passed=[];
  if(await select(null,null,true)!==en.join(' '))throw Error('whole paragraph failed');passed.push('whole paragraph recovers cached source despite cloned citation markers');
  if(await select(s[1],stop)!==en[1])throw Error('fragmented sentence failed');passed.push('split sentence and citation punctuation yield one English sentence');
  chrome.runtime.sendMessage=async()=>({ok:true,annotations:[{annotationKey:'old',attachmentID:2,text:en[1],comment:'Existing note',color:'#ffd400'}]});
  document.querySelector('.pb-saved-refresh').click();await wait();
  if(CSS.highlights.size!==1)throw Error('readback fragmented sentence failed');passed.push('existing Zotero annotation also maps across cloned fragments');
  const r=document.createRange();r.setStart(s[1].firstChild,2);r.setEnd(s[1].firstChild,10);getSelection().removeAllRanges();getSelection().addRange(r);p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();
  if(!document.querySelector('.pb-open-selection').disabled)throw Error('partial fragment guessed');passed.push('partial fragment still refused');
  const bad=s[1].cloneNode(true);bad.dataset.pbSentence='missing-record';p.append(bad);await select(null,null,true);
  if(!document.querySelector('.pb-open-selection').disabled)throw Error('unknown marker bypassed');bad.remove();passed.push('unknown marker cannot bypass source validation');
  const foreign=document.createElement('p');foreign.append(s[1].cloneNode(true),stop.cloneNode(true));document.getElementById('paper').append(foreign);await wait();
  const fr=document.createRange();fr.selectNodeContents(foreign);getSelection().removeAllRanges();getSelection().addRange(fr);foreign.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();
  if(!document.querySelector('.pb-open-selection').disabled)throw Error('foreign owner accepted');passed.push('copied markers in another paragraph rejected');
  return {passed};
 });
}
