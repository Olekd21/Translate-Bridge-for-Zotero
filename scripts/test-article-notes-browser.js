async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 await page.addStyleTag({url:'http://127.0.0.1:18841/packages/browser-extension/content.css'});
 await page.setViewportSize({width:1440,height:900});
 return await page.evaluate(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms)),passed=[],calls=[],drafts={};let rows=[],fail=false;
  const check=(name,condition)=>{if(!condition)throw Error(name);passed.push(name);};
  chrome.storage.local={get:async defaults=>({...defaults,...drafts}),set:async values=>Object.assign(drafts,values)};
  chrome.runtime.sendMessage=async msg=>{
   calls.push(msg);
   if(msg.type!=='paperbridge:article-notes')return {ok:true,annotations:[]};
   if(msg.payload.action==='list')return {ok:true,parentID:42,libraryID:1,parentKey:'PAPER',notes:rows};
   if(fail)return {ok:false,error:'Conflict from Zotero'};
   const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
   const note={key:msg.payload.key||'NOTE1',title:msg.payload.title,html:`<div><h1>${escape(msg.payload.title)}</h1><p>${escape(msg.payload.text)}</p></div>`};rows=[note];return {ok:true,note};
  };
  document.querySelector('.pb-panel').dataset.open='true';
  const details=document.querySelector('.pb-saved-section details');check('annotations initially collapsed',!details.open);
  check('header is outside scrolling reader',!document.querySelector('.pb-reading-scroll').contains(details));
  document.querySelector('.pb-notes-toggle').click();await sleep(200);
  const panel=document.querySelector('.pb-article-notes'),title=panel.querySelector('input'),body=panel.querySelector('textarea'),save=panel.querySelector('.pb-note-save');
  check('notes work without a PDF selection',!panel.hidden&&document.querySelector('.pb-dock').hidden);
  title.value='文章机制';body.value='My independent reasoning';body.dispatchEvent(new Event('input'));await sleep(100);
  check('local draft persists',Object.values(drafts).some(d=>d?.text===body.value));
  save.click();await sleep(300);
  check('save targets exact parent without quote',calls.some(c=>c.payload?.action==='save'&&c.payload.parentID===42&&!c.payload.selector));
  check('success displays saved child',panel.querySelector('.pb-note-list').value==='NOTE1');
  body.value='Revised reasoning';body.dispatchEvent(new Event('input'));await sleep(80);fail=true;save.click();await sleep(200);
  check('save failure keeps draft and text',body.value==='Revised reasoning'&&panel.querySelector('.pb-note-status').textContent.includes('Conflict'));
  fail=false;save.click();await sleep(250);
  check('second save updates same note key',calls.filter(c=>c.payload?.action==='save').at(-1).payload.key==='NOTE1'&&rows.length===1);
  document.querySelector('.pb-notes-toggle').click();await sleep(80);
  check('return restores reading controls',panel.hidden&&!document.querySelector('.pb-dock').hidden);
  return {passed};
 });
}
