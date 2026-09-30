import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
import {transform} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const source=await readFile('packages/zotero-addon/src/modules/bridgeServer.ts','utf8');
const fn=source.slice(source.indexOf('async function saveNativeHighlight('),source.indexOf('\nclass PingEndpoint'));
const js=(await transform(fn,{loader:'ts'})).code;
function harness(failSecond=false){
 const rows=[];let calls=0;
 const ctx=vm.createContext({pageLabelFor:(_,i)=>String(i+1),annotationComment:()=>'',normalizeAnnotationColor:()=> '#ffd400',
 Zotero:{DataObjectUtilities:{generateKey:()=>`key${calls}`},Annotations:{async saveFromJSON(_,data){calls++;if(failSecond&&calls===2)throw Error('save failed'); const item={key:data.key,position:data.position,async eraseTx(){rows.splice(rows.indexOf(item),1);}};rows.push(item);return item;}}}});
 vm.runInContext(js,ctx);return {rows,save:ctx.saveNativeHighlight};
}
const match=()=>({status:'unique',occurrences:1,pageIndex:6,rects:[[1,2,3,4]],additionalPages:[{pageIndex:8,rects:[[2,3,4,5]],offset:1,top:2,text:'tail'}]});
const annotation={selector:{exact:'Full selection'},comment:'note'};
test('nonadjacent pages save distinct native positions and retain full comment context',async()=>{
 const h=harness(),m=match();await h.save({}, {id:1},annotation,m);
 assert.deepEqual(h.rows.map(r=>r.position.pageIndex),[6,8]);
 assert.ok(h.rows.every(r=>!r.position.nextPageRects));assert.equal(m.pageLabel,'7、9');
});
test('failed second page removes only the new first-page annotation',async()=>{
 const h=harness(true);await assert.rejects(h.save({}, {id:1},annotation,match()),/save failed/);assert.equal(h.rows.length,0);
});
