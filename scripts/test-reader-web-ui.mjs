import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const b=await build({entryPoints:['packages/zotero-addon/src/modules/readerUI.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {registerReaderUI}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].contents).toString('base64'));

function setup({asyncAttachment=false}={}){
 const events=new Map(),opened=[];
 const element=(tag,namespaceURI)=>({tag,namespaceURI,style:{},children:[],attrs:{},isConnected:false,
   setAttribute(k,v){this.attrs[k]=v;},append(...children){this.children.push(...children);for(const c of children){c.parent=this;c.isConnected=true;}},
   listeners:new Map(),addEventListener(event,handler){const rows=this.listeners.get(event)||[];rows.push(handler);this.listeners.set(event,rows);},
   emit(event,init={}){for(const handler of this.listeners.get(event)||[])handler({type:event,button:0,...init});},
   click(){this.emit('click');},remove(){this.isConnected=false;this.parent?.children.splice(this.parent.children.indexOf(this),1);}});
 const slot=element('div');
 const doc={createElement:tag=>element(tag),createElementNS:(ns,tag)=>element(tag,ns),
   documentElement:element('html'),defaultView:{},
   querySelector:selector=>selector.includes('.toolbar')?slot:slot.children.find(c=>c.attrs['data-pb-reader-action']==='toolbar')};
 const reader={itemID:2,_iframeWindow:{document:doc}};
 const attachment={parentID:1},parent={getField:key=>key==='url'?'https://example.org/paper':key==='DOI'?'10.test/paper':''};
 globalThis.Zotero={Reader:{_readers:[reader],registerEventListener:(t,h)=>events.set(t,h),unregisterEventListener:(t,h)=>{assert.equal(events.get(t),h);events.delete(t);}},
   getMainWindow:()=>({setInterval(){throw Error('reader UI must not poll')}}),
   Items:{get:id=>asyncAttachment?undefined:id===2?attachment:parent,getAsync:async id=>id===2?attachment:parent},
   Utilities:{randomString:n=>'B'.repeat(n)},launchURL:url=>opened.push(url)};
 return {events,opened,slot,doc,reader};
}
test('existing reader is event-driven; one pointer gesture opens once and toolbar recreation stays single',async()=>{
 const h=setup(),cleanup=registerReaderUI();
 assert.equal(h.slot.children.length,1);
 const button=h.slot.children[0];assert.equal(button.children[0].tag,'svg');assert.equal(button.children[0].children.length,2);
 assert.equal(button.children[1].textContent,'网页阅读');assert.match(button.style.cssText,/width:auto/);
 button.emit('pointerdown');button.click();await Promise.resolve();
 assert.deepEqual(h.opened,['https://example.org/paper']);
 h.events.get('renderToolbar')({reader:h.reader,doc:h.doc});assert.equal(h.slot.children.length,1);
 button.remove();h.events.get('renderToolbar')({reader:h.reader,doc:h.doc});assert.equal(h.slot.children.length,1);
 const popup=[];h.events.get('renderTextSelectionPopup')({reader:h.reader,doc:h.doc,params:{annotation:{text:'The PDF selection to locate'}},append:n=>{n.isConnected=true;popup.push(n);}});
 popup[0].click();await Promise.resolve();assert.match(h.opened[1],/#pb-web=B{32}$/);
 assert.equal(popup[0].children[1].textContent,'网页阅读');
 cleanup();assert.equal(h.events.size,0);assert.equal(h.slot.children.length,0);
 assert.equal(popup[0].isConnected,false);
 h.events.get('renderToolbar')?.({reader:h.reader,doc:h.doc});assert.equal(h.slot.children.length,0);
});
test('first reader click waits for an uncached attachment instead of requiring another click',async()=>{
 const h=setup({asyncAttachment:true}),cleanup=registerReaderUI();
 h.slot.children[0].click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.opened,['https://example.org/paper']);
 cleanup();
});
test('cleanup preserves unrelated Zotero listener registrations',()=>{
 const h=setup(),other={type:'renderToolbar',handler:()=>{},pluginID:'other'};
 const cleanup=registerReaderUI();
 Zotero.Reader._registeredListeners=[other,...[...h.events].map(([type,handler])=>({type,handler}))];
 cleanup();assert.deepEqual(Zotero.Reader._registeredListeners,[other]);
});
