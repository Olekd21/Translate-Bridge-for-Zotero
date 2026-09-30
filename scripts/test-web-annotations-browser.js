async(page) => {
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  await page.addStyleTag({url:'http://127.0.0.1:18841/packages/browser-extension/content.css'});
  return await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const passed = []; const calls = [];
    const p = document.createElement('p'); p.id='saved-test';
    const text = 'The cardiac lymphatic network maintains fluid balance in the heart.';
    p.textContent = text + ' Further research is needed to clarify the mechanisms.'; document.getElementById('paper').append(p); await wait(200);
    let rows = [
      {annotationKey:'one',attachmentID:15,text,comment:'<b>My note</b><img src=x onerror="window.bad=true">',color:'#ffd400',pageLabel:'2'},
      {annotationKey:'two',attachmentID:15,text:'A completely absent sentence remains visible in the annotation list.',comment:'Unmatched note',color:'#ff6666',pageLabel:'3'},
      {annotationKey:'three',attachmentID:16,text:'',comment:'Image annotation note',color:'bad-css',pageLabel:'4'}
    ];
    chrome.runtime.sendMessage = async message => {calls.push(message); return message.type === 'paperbridge:list-annotations' ? {ok:true,annotations:rows} : {ok:true};};
    const refresh = async () => {document.querySelector('.pb-saved-refresh').click();await wait(250);};
    await refresh();
    if(document.querySelectorAll('.pb-saved-card').length!==3 || CSS.highlights.size!==1) throw Error('list/highlight mismatch');
    if(window.bad || document.querySelector('.pb-saved-card img') || !document.querySelector('.pb-saved-card').textContent.includes('My note')) throw Error('comment unsafe');
    passed.push('text, unmatched and nontext annotations listed; safe rich text; one highlight');
    document.querySelector('.pb-saved-card button').click(); await wait(80);
    if(!calls.some(c=>c.type==='paperbridge:open-annotation'&&c.target.annotationKey==='one'&&c.target.attachmentID===15)) throw Error('open target');
    passed.push('open annotation preserves exact attachment/key');
    await refresh(); if(CSS.highlights.size!==1 || document.querySelectorAll('.pb-saved-card').length!==3) throw Error('duplicate refresh');
    passed.push('refresh does not duplicate');
    const range=[...CSS.highlights.get('pb-saved-0')][0];
    const rect=range.getClientRects()[0];
    document.querySelector('.pb-panel').dataset.open='false';
    p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+2,clientY:rect.top+2}));
    if(document.querySelector('.pb-panel').dataset.open!=='true')throw Error('highlight click did not open notes');
    passed.push('clicking webpage highlight opens annotation sidebar');
    const duplicate=document.createElement('p'); duplicate.textContent=text; document.getElementById('paper').append(duplicate);await wait(1000);
    if(CSS.highlights.size!==0) throw Error('ambiguous text highlighted');
    duplicate.remove();await wait(1000);
    passed.push('duplicate quotes remain sidebar only; removal relocalizes');
    const span=p.querySelector('[data-pb-sentence]');if(!span)throw Error('missing sentence marker');
    span.textContent='心脏淋巴网络维持心脏中的体液平衡。';await wait(1000);
    if(CSS.highlights.size!==1)throw Error('translated complete sentence not restored');
    passed.push('translated full sentence uses verified original cache');
    span.textContent += '后一句无法可靠确认的开头';await wait(1000);
    if(CSS.highlights.size!==0)throw Error('drifted translation highlighted');
    passed.push('unverified translated boundary remains sidebar only');
    rows=[];await refresh();if(CSS.highlights.size || document.querySelectorAll('.pb-saved-card').length)throw Error('deleted annotation retained');
    passed.push('deleted annotations removed on refresh');
    chrome.runtime.sendMessage=async()=>({ok:false,error:'Zotero offline'});await refresh();
    if(!document.querySelector('.pb-saved-status').textContent.includes('offline')||document.querySelector('.pb-saved-refresh').disabled)throw Error('offline retry');
    passed.push('offline error visible and retry available');
    return {passed};
  });
}
