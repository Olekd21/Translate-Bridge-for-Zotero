async(page)=>{
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  await page.setContent('<style>body{font:14px system-ui;background:#fafafa;color:#222}.toolbar{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid #ddd}.end,.custom-sections{display:flex;align-items:center;gap:6px}.popup{margin:40px;width:250px;padding:12px;border:1px solid #ccc;border-radius:8px;background:white}</style><div class="toolbar"><div>PDF 阅读器</div><div class="end"><div class="custom-sections"></div><button>查找</button></div></div><div class="popup">选中文字<div class="section"></div></div>');
  await page.evaluate(()=>{
    globalThis.readerEvents=new Map();globalThis.opened=[];
    globalThis.Zotero={Reader:{_readers:[{itemID:2,_iframeWindow:window}],registerEventListener:(t,h)=>readerEvents.set(t,h),unregisterEventListener:t=>readerEvents.delete(t)},
      getMainWindow:()=>window,Items:{get:id=>id===2?{parentID:1}:{getField:k=>k==='url'?'https://example.org/paper':k==='DOI'?'10.test/paper':''}},Utilities:{randomString:n=>'T'.repeat(n)},launchURL:url=>opened.push(url)};
  });
  await page.addScriptTag({url:'http://127.0.0.1:18841/.cache/reader-ui141.js'});
  const result=await page.evaluate(async()=>{
    const cleanup=ReaderUITest.registerReaderUI(),reader=Zotero.Reader._readers[0];
    readerEvents.get('renderTextSelectionPopup')({reader,doc:document,params:{annotation:{text:'Selected scientific text'}},append:n=>document.querySelector('.section').append(n)});
    const describe=n=>({text:n.textContent,svg:n.querySelector('svg')?.getBoundingClientRect().width,width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,images:n.querySelectorAll('img').length});
    const buttons=[...document.querySelectorAll('.paperbridge-reader-web')];
    const layout=buttons.map(describe);
    if(layout.length!==2||layout.some(b=>b.text!=='网页阅读'||b.svg!==24||b.width<96||b.height<32||b.images))throw Error(JSON.stringify(layout));
    buttons.forEach(b=>b.click());
    if(opened[0]!=='https://example.org/paper'||!opened[1].endsWith('#pb-web='+'T'.repeat(32)))throw Error('Click navigation differs');
    document.querySelector('.custom-sections').replaceChildren();
    await new Promise(r=>setTimeout(r,25));
    if(document.querySelectorAll('[data-pb-reader-action="toolbar"]').length!==1)throw Error('Toolbar redraw failed');
    globalThis.readerCleanup=cleanup;
    return {layout,opened,redraw:true};
  });
  await page.screenshot({path:'E:/CodexProjects/ChatGPT/文献解读/output/playwright/reader141.png'});
  await page.evaluate(()=>readerCleanup());
  if(await page.locator('.paperbridge-reader-web').count())throw Error('Leaked reader controls');
  return result;
}
