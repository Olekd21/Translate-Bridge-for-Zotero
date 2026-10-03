import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const b=await build({entryPoints:['packages/zotero-addon/src/modules/readerUI.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {registerReaderUI}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].contents).toString('base64'));

function setup(){
 const events=new Map(),opened=[],observations=[];let tick,cleared=false;
 const element=(tag,namespaceURI)=>({tag,namespaceURI,style:{},children:[],attrs:{},isConnected:false,
   setAttribute(k,v){this.attrs[k]=v;},append(...children){this.children.push(...children);for(const c of children){c.parent=this;c.isConnected=true;}},
   addEventListener(_event,handler){this.click=handler;},remove(){this.isConnected=false;this.parent?.children.splice(this.parent.children.indexOf(this),1);}});
 const slot=element('div');
 const doc={createElement:tag=>element(tag),createElementNS:(ns,tag)=>element(tag,ns),
   documentElement:element('html'),defaultView:{MutationObserver:class{constructor(cb){this.cb=cb;observations.push(this);}observe(){}disconnect(){this.disconnected=true;}}},
   querySelector:selector=>selector.includes('.toolbar')?slot:slot.children.find(c=>c.attrs['data-pb-reader-action']==='toolbar')};
 const reader={itemID:2,_iframeWindow:{document:doc}};
 globalThis.Zotero={Reader:{_readers:[reader],registerEventListener:(t,h)=>events.set(t,h),unregisterEventListener:(t,h)=>{assert.equal(events.get(t),h);events.delete(t);}},
   getMainWindow:()=>({setInterval:cb=>{tick=cb;return 12;},clearInterval:id=>{assert.equal(id,12);cleared=true;}}),
   Items:{get:id=>id===2?{parentID:1}:{getField:key=>key==='url'?'https://example.org/paper':key==='DOI'?'10.test/paper':''}},
   Utilities:{randomString:n=>'B'.repeat(n)},launchURL:url=>opened.push(url)};
 return {events,opened,slot,doc,reader,observations,tick:()=>tick(),cleared:()=>cleared};
}
test('existing reader gets upper-right icon AND text; toolbar recreation stays single; cleanup stops watchers',()=>{
 const h=setup(),cleanup=registerReaderUI();
 assert.equal(h.slot.children.length,1);
 const button=h.slot.children[0];assert.equal(button.children[0].tag,'svg');assert.equal(button.children[0].children.length,2);
 assert.equal(button.children[1].textContent,'网页阅读');assert.match(button.style.cssText,/width:auto/);
 button.click();assert.equal(h.opened[0],'https://example.org/paper');
 h.events.get('renderToolbar')({reader:h.reader,doc:h.doc});h.tick();assert.equal(h.slot.children.length,1);
 button.remove();h.observations[0].cb();assert.equal(h.slot.children.length,1);
 const popup=[];h.events.get('renderTextSelectionPopup')({reader:h.reader,doc:h.doc,params:{annotation:{text:'The PDF selection to locate'}},append:n=>{n.isConnected=true;popup.push(n);}});
 popup[0].click();assert.match(h.opened[1],/#pb-web=B{32}$/);
 assert.equal(popup[0].children[1].textContent,'网页阅读');
 cleanup();assert.equal(h.events.size,0);assert.equal(h.slot.children.length,0);assert.ok(h.cleared());
 assert.ok(h.observations.every(o=>o.disconnected));assert.equal(popup[0].isConnected,false);
 h.tick();assert.equal(h.slot.children.length,0);
});
test('cleanup preserves unrelated Zotero listener registrations',()=>{
 const h=setup(),other={type:'renderToolbar',handler:()=>{},pluginID:'other'};
 const cleanup=registerReaderUI();
 Zotero.Reader._registeredListeners=[other,...[...h.events].map(([type,handler])=>({type,handler}))];
 cleanup();assert.deepEqual(Zotero.Reader._registeredListeners,[other]);
});
