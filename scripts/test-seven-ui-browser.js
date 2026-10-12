async(page)=>{
 await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
 await page.addStyleTag({url:'http://127.0.0.1:18841/packages/browser-extension/content.css'});
 return await page.evaluate(async()=>{
  window.confirm=()=>{throw Error('Web annotation deletion must not ask for confirmation');};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));const passed=[];const calls=[];
  const text='A uniquely identifiable selected passage is present in this document for the browser navigation test.';
  const p=document.createElement('p');p.textContent=text;document.querySelector('#paper').append(p);await wait(250);
  let rows=[{annotationKey:'A',attachmentID:12,text,comment:'Original note',color:'#ffd400',pageLabel:'1'}];
  let conflict=false;
  chrome.runtime.sendMessage=async msg=>{
   calls.push(msg);
   if(msg.type==='paperbridge:list-annotations')return {ok:true,annotations:rows};
   if(msg.type==='paperbridge:web-selection')return {ok:true,exact:text};
   if(msg.type==='paperbridge:import-document')return {ok:true,itemID:9,state:'no-pdf'};
   if(msg.type==='paperbridge:mutate-annotation'){
    if(conflict)return {ok:false,error:'conflict'};
    if(msg.payload.action==='edit')rows[0].comment=msg.payload.comment;else rows=[];
    return {ok:true};
   }return {ok:true};
  };
  const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent===label);
  document.querySelector('.pb-saved-refresh').click();await wait(200);
  button('编辑内容').click();let editor=document.querySelector('.pb-saved-card textarea');editor.value='My revised note';editor.dispatchEvent(new Event('input'));
  button('保存到 Zotero').click();await wait(200);if(rows[0].comment!=='My revised note')throw Error('edit not saved');passed.push('edit persisted through API and refreshed');
  button('编辑内容').click();editor=document.querySelector('.pb-saved-card textarea');editor.value='Unsaved draft';editor.dispatchEvent(new Event('input'));conflict=true;
  button('保存到 Zotero').click();await wait(150);if(editor.value!=='Unsaved draft'||!document.querySelector('.pb-saved-status').textContent.includes('conflict'))throw Error('draft lost');passed.push('failed edit preserves draft');
  button('取消').click();conflict=false;
  const range=CSS.highlights.values().next().value.values().next().value;range.startContainer.parentElement.scrollIntoView();await wait(100);
  document.querySelector('.pb-saved-section details').open=false;
  const rect=range.getClientRects()[0];document.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+4,clientY:rect.top+4}));await wait(100);
  if(!document.querySelector('.pb-saved-section details').open||!document.querySelector('.pb-saved-active'))throw Error('click scroll card missing');passed.push('click opens collapsed list and emphasizes card');
  button('删除批注').click();await wait(200);if(rows.length||document.querySelector('.pb-saved-card'))throw Error('delete failed');passed.push('direct deletion removes card and highlight without confirmation');
  location.hash='pb-web='+'A'.repeat(32);await wait(500);
  if(!CSS.highlights.has('pb-web-selection')||!document.querySelector('.pb-saved-status').textContent.includes('已定位 PDF'))throw Error('PDF to web location failed');passed.push('PDF ticket locates and highlights webpage');
  button('添加到 Zotero').click();await wait(150);
  if(!document.querySelector('.pb-saved-status').textContent.includes('未取得可用 PDF'))throw Error('import claims PDF success');passed.push('import distinguishes item success from missing PDF');
  button('管理待同步记录').click();await wait(50);if(!calls.some(c=>c.type==='paperbridge:settings'))throw Error('queue entry absent');passed.push('queue manager entry opens settings');
  return {passed};
 });
}
