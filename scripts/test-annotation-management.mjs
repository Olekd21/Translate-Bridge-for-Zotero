import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const compiled=await build({entryPoints:['packages/zotero-addon/src/modules/bridgeServer.ts'],bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
function harness(){
 const items=new Map();let next=1,saves=0;const endpoints={};
 class Item {
  constructor(type){this.type=type;this.id=next++;this.key='key'+this.id;this.fields={};this.libraryID=1;this.annotations=[];this.attachments=[];}
  getField(k){return this.fields[k]||'';}setField(k,v){this.fields[k]=v;}isRegularItem(){return !this.pdf;}
  isPDFAttachment(){return this.pdf===true;}getAnnotations(){return this.annotations;}getAttachments(){return this.attachments;}
  isNote(){return this.type==='note';}getNotes(){return [...items.values()].filter(n=>n.parentID===this.id).map(n=>n.id);}setNote(html){this.html=html;}getNote(){return this.html||'';}getNoteTitle(){return 'Test note';}
  setCreators(v){this.creators=v;}async saveTx(){items.set(this.id,this);saves++;}async save(){items.set(this.id,this);saves++;}
 }
 class Search{addCondition(k,_op,v){this[k]=v;}async search(){return [...items.values()].filter(i=>i.isRegularItem() && (this.DOI?i.getField('DOI')===this.DOI:i.getField('url')===this.url)).map(i=>i.id);}}
 globalThis.Zotero={Server:{Endpoints:endpoints},Prefs:{get:()=> 'test-token'},Item,Search,Items:{get:id=>items.get(id)},
  Libraries:{userLibraryID:1,get:()=>({editable:true})},DB:{executeTransaction:fn=>fn()},Utilities:{randomString:n=>'A'.repeat(n)},Attachments:{addAvailableFile:async()=>false}};
 api.registerBridgeServer();
 const call=async(path,data,token='test-token')=>{const r=await new endpoints[path]().init({method:'POST',headers:{'X-Paper-Bridge-Token':token},data});return {status:r[0],body:JSON.parse(r[2])};};
 return {items,Item,call,saves:()=>saves};
}
test('annotation edits escape HTML, retain source, reject conflicts and target exact attachment',async()=>{
 const h=harness(),pdf=new h.Item(),annotation=new h.Item();pdf.pdf=true;h.items.set(pdf.id,pdf);pdf.annotations=[annotation];annotation.annotationComment='old';annotation.annotationText='source';annotation.annotationPosition='unchanged';
 const input={attachmentID:pdf.id,annotationKey:annotation.key,action:'edit',expectedComment:'old',comment:'<script>hello</script>'};
 assert.equal((await h.call('/paperbridge/mutate-annotation',input,'bad')).status,401);
 assert.equal((await h.call('/paperbridge/mutate-annotation',{...input,annotationKey:'wrong'})).status,404);
 assert.equal((await h.call('/paperbridge/mutate-annotation',input)).status,200);
 assert.equal(annotation.annotationComment,'<p>&lt;script&gt;hello&lt;/script&gt;</p>');assert.equal(annotation.annotationPosition,'unchanged');assert.equal(annotation.annotationText,'source');
 assert.equal((await h.call('/paperbridge/mutate-annotation',input)).status,409);
 assert.equal((await h.call('/paperbridge/mutate-annotation',{...input,action:'delete',expectedComment:annotation.annotationComment})).status,200);assert.equal(annotation.deleted,true);
});
test('article notes bind exact parent, escape content, update same child and preserve external changes',async()=>{
 const h=harness(),parent=new h.Item();parent.fields.DOI='10.test/notes';h.items.set(parent.id,parent);
 const document={doi:'10.test/notes',title:'Paper'};
 assert.equal((await h.call('/paperbridge/article-notes',{action:'list',document},'bad')).status,401);
 const listing=await h.call('/paperbridge/article-notes',{action:'list',document});assert.equal(listing.status,200);assert.deepEqual(listing.body.notes,[]);
 const data={action:'save',document,parentID:parent.id,libraryID:1,parentKey:parent.key,title:'My <note>',text:'First line\n<script>plain text</script>'};
 assert.equal((await h.call('/paperbridge/article-notes',{...data,parentID:999})).status,409);
 const saved=await h.call('/paperbridge/article-notes',data);assert.equal(saved.status,200);assert.match(saved.body.note.html,/&lt;script&gt;/);assert.equal(parent.getNotes().length,1);
 const updated=await h.call('/paperbridge/article-notes',{...data,key:saved.body.note.key,expectedHTML:saved.body.note.html,text:'Updated'});assert.equal(updated.status,200);assert.equal(parent.getNotes().length,1);
 assert.equal((await h.call('/paperbridge/article-notes',{...data,key:saved.body.note.key,expectedHTML:saved.body.note.html,text:'Stale'})).status,409);
 assert.match(h.items.get(parent.getNotes()[0]).getNote(),/Updated/);
 assert.equal((await h.call('/paperbridge/article-notes',{...data,document:{doi:'10.test/other'}})).status,404);
});
test('import creates bibliographic item once, distinguishes missing PDF, rejects invalid metadata',async()=>{
 const h=harness();const input={document:{title:'Example paper',doi:'10.test/example',url:'https://example.org/article',authors:['Test Author']}};
 assert.equal((await h.call('/paperbridge/import-document',input,'bad')).status,401);
 assert.equal((await h.call('/paperbridge/import-document',{document:{title:'X',url:'file:///private'}})).status,400);
 const [a,b]=await Promise.all([h.call('/paperbridge/import-document',input),h.call('/paperbridge/import-document',input)]);
 assert.equal(a.status,200);assert.equal(b.body.itemID,a.body.itemID);assert.equal(b.body.existing,true);assert.equal(h.items.size,1);
 assert.equal(h.items.get(a.body.itemID).creators[0].lastName,'Test Author');
 const status=await h.call('/paperbridge/import-document',{action:'status',itemID:a.body.itemID});assert.equal(status.body.state,'no-pdf');
});
test('web selection tickets require pairing and matching document identity',async()=>{
 const h=harness(),ticket=api.queueWebSelection('Exact PDF quotation','10.test/one','https://example.org/one');
 assert.equal((await h.call('/paperbridge/web-selection',{ticket,doi:'10.test/one'},'bad')).status,401);
 assert.equal((await h.call('/paperbridge/web-selection',{ticket,doi:'10.test/two'})).status,409);
 assert.equal((await h.call('/paperbridge/web-selection',{ticket,doi:'10.test/one'})).body.exact,'Exact PDF quotation');
 assert.equal((await h.call('/paperbridge/web-selection',{ticket:'missing',doi:'10.test/one'})).status,404);
});
