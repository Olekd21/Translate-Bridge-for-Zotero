import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {transform} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const source=await readFile('packages/zotero-addon/src/modules/bridgeServer.ts','utf8');
const code=(await transform(source.slice(source.indexOf('class ListAnnotationsEndpoint'),source.indexOf('const importJobs ='))+'\nglobalThis.Endpoint=ListAnnotationsEndpoint;', {loader:'ts'})).code;
function harness(doi='10.test/paper') {
  let lookups=0;
  const records={1:{id:1,isPDFAttachment:()=>true,getAnnotations:()=>[
    {key:'A',annotationText:'Original text',annotationComment:'My note',annotationColor:'#ffd400',annotationPageLabel:'2',annotationType:'highlight'},
    {key:'DELETED',deleted:true}
  ]},2:{id:2,isPDFAttachment:()=>true,getAnnotations:()=>[{key:'B',annotationType:'image',annotationComment:'Image note'}]},3:{deleted:true,isPDFAttachment:()=>true}};
  const ctx=vm.createContext({jsonResponse:(s,b)=>[s,b],requestHeader:r=>r.headers?.token,getOrCreatePairingToken:()=> 'test-only',parseDocumentBody:r=>r.data,
    normalizeDOI:x=>String(x||'').toLowerCase(),findParentItem:async()=>{lookups++;return {item:{getField:()=>doi,getAttachments:()=>[1,2,3]},candidateCount:1};},
    Zotero:{Items:{get:id=>records[id]}}});
  vm.runInContext(code,ctx);
  return {endpoint:new ctx.Endpoint(),lookups:()=>lookups};
}
test('read-only list includes all PDFs and image notes, excludes deleted data',async()=>{
  const h=harness();const [status,body]=await h.endpoint.init({headers:{token:'test-only'},data:{document:{doi:'10.test/paper'}}});
  assert.equal(status,200);assert.equal(body.annotations.length,2);assert.equal(body.annotations[0].comment,'My note');assert.equal(body.annotations[1].attachmentID,2);
});
test('invalid token denied before library lookup',async()=>{
  const h=harness();assert.equal((await h.endpoint.init({headers:{token:'bad'}}))[0],401);assert.equal(h.lookups(),0);
});
test('DOI mismatch never exposes title-fallback annotations',async()=>{
  const h=harness('10.test/other');assert.equal((await h.endpoint.init({headers:{token:'test-only'},data:{document:{doi:'10.test/paper'}}}))[0],409);
});
