import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {issueAction,issueURL,ISSUE_KEY,openIssue,issueForTab} from '../packages/browser-extension/issue-store.js';
let disk,session,opened,failWrite;
const sample=(extra={})=>({version:'1.5.2',category:'mapping',code:'missing-source',message:'No source',
  document:{url:'https://example.org/article',title:'Article',doi:'10.1000/example'},
  selector:{exact:'这一段无法找到原文。',paragraph:'背景。这一段无法找到原文。结论。'},
  diagnostic:{blocks:[{reason:'missing-source'}]},...extra});
beforeEach(()=>{
  disk={};session={};opened=[];failWrite=false;
  const area=data=>({get:async defaults=>typeof defaults==='string'?structuredClone({[defaults]:data[defaults]}):structuredClone({...defaults,...data}),
    set:async values=>{if(failWrite)throw Error('quota');Object.assign(data,structuredClone(values));}});
  globalThis.chrome={storage:{local:area(disk),session:area(session)},runtime:{getManifest:()=>({version:'1.5.3'})},
    tabs:{create:async input=>{opened.push(input);return{id:8};},update:async(id,input)=>{assert.ok(session['paperbridgeIssueTab:8']);opened.push(input);},remove:async()=>{}}};
});
test('parallel errors survive and repeated failures deduplicate across versions',async()=>{
  await Promise.all(Array.from({length:20},()=>issueAction({action:'record',issue:sample()})));
  await issueAction({action:'record',issue:sample({version:'1.5.3'})});
  const {records}=await issueAction({action:'list'});
  assert.equal(records.length,1);assert.equal(records[0].occurrences,21);assert.equal(records[0].first.version,'1.5.2');assert.equal(records[0].latest.version,'1.5.3');
});
test('reappearing resolved failures reopen but preserve review notes and history',async()=>{
  const {id}=await issueAction({action:'record',issue:sample()});
  await issueAction({action:'update',id,patch:{status:'resolved',note:'逐句验证通过'}});
  await issueAction({action:'record',issue:sample()});
  const row=(await issueAction({action:'list'})).records[0];
  assert.equal(row.status,'unresolved');assert.equal(row.note,'逐句验证通过');assert.equal(row.reviews[0].status,'resolved');assert.equal(row.reviews[0].version,'1.5.3');
});
test('export/import round trip keeps evidence and notes; duplicate import never overwrites local review',async()=>{
  const {id}=await issueAction({action:'record',issue:sample()});await issueAction({action:'update',id,patch:{status:'unresolved',note:'仍不能匹配'}});
  const {archive}=await issueAction({action:'export'});disk={};
  globalThis.chrome.storage.local={get:async defaults=>structuredClone({...defaults,...disk}),set:async v=>Object.assign(disk,structuredClone(v))};
  assert.equal((await issueAction({action:'import',archive})).added,1);
  const row=(await issueAction({action:'list'})).records[0];assert.equal(row.note,'仍不能匹配');assert.equal(row.latest.selector.exact,sample().selector.exact);
  await issueAction({action:'update',id:row.id,patch:{status:'resolved'}});
  assert.equal((await issueAction({action:'import',archive})).skipped,1);
  assert.equal((await issueAction({action:'list'})).records[0].status,'resolved');
});
test('credentials and unexpected settings never enter exports; unsafe URLs rejected',async()=>{
  await issueAction({action:'record',issue:sample({document:{url:'https://user:pass@example.org/p?token=secret&part=4#pb-web=secret'},
    pairingToken:'secret',diagnostic:{cookie:'secret',authorization:'secret',payload:{apiKey:'secret'},reason:'kept'}})});
  const {archive}=await issueAction({action:'export'});assert.ok(!JSON.stringify(archive).includes('secret'));
  assert.equal(archive.records[0].latest.document.url,'https://example.org/p?part=4');
  assert.equal(issueURL('javascript:alert(1)'),'');assert.equal(issueURL('file:///private'),'');
});
test('failed writes and invalid imports preserve earlier durable records',async()=>{
  await issueAction({action:'record',issue:sample()});const before=JSON.stringify(disk);
  failWrite=true;await assert.rejects(issueAction({action:'record',issue:sample({code:'another'})}),/quota/);
  assert.equal(JSON.stringify(disk),before);failWrite=false;
  await assert.rejects(issueAction({action:'import',archive:{schemaVersion:2,records:[]}}));assert.equal(JSON.stringify(disk),before);
});
test('explicit revisit stores tab routing before navigation and does not leak records to other pages',async()=>{
  const {id}=await issueAction({action:'record',issue:sample()});await openIssue(id);
  assert.deepEqual(opened,[{url:'about:blank'},{url:'https://example.org/article'}]);
  assert.equal((await issueForTab({tab:{id:8},url:'https://example.org/unrelated'})).record,null);
  assert.equal((await issueForTab({tab:{id:9},url:'https://example.org/article'})).record,null);
  assert.equal((await issueForTab({tab:{id:8},url:'https://example.org/article#part'})).record.id,id);
});
test('persistent data remains available after service worker module restart',async()=>{
  const {id}=await issueAction({action:'record',issue:sample()});
  const restarted=await import('../packages/browser-extension/issue-store.js?restart');
  assert.equal((await restarted.issueAction({action:'list'})).records[0].id,id);
  assert.equal(disk[ISSUE_KEY].schemaVersion,1);
});
test('archive capacity refuses new records without silently evicting earlier evidence',async()=>{
  await issueAction({action:'record',issue:sample()});const row=disk[ISSUE_KEY].records[0];
  disk[ISSUE_KEY].records=Array.from({length:500},(_,i)=>({...structuredClone(row),id:`entry-${i}`,fingerprint:`distinct-${i}`}));
  const before=JSON.stringify(disk);
  await assert.rejects(issueAction({action:'record',issue:sample({code:'new-kind'})}),/容量上限/);
  assert.equal(JSON.stringify(disk),before);
});
test('late operational failures keep their request context in memory without writing a record',async()=>{
  const source=await readFile('packages/browser-extension/content.js','utf8');
  const start=source.indexOf('  async function bridgeMessage('),end=source.indexOf('\n  function ',start);
  let current={anchor:{exact:'Original selection'},document:{url:'https://example.org/first'}};
  let finish;const errors=[];
  const ctx=vm.createContext({issueContext:()=>current,rememberIssue:(message,type,context)=>errors.push(context),
    chrome:{runtime:{sendMessage:()=>new Promise(resolve=>{finish=resolve;})}}});
  vm.runInContext(source.slice(start,end),ctx);
  const pending=vm.runInContext('bridgeMessage({type:"paperbridge:open-selection"})',ctx);
  current={anchor:{exact:'New selection'},document:{url:'https://example.org/second'}};
  finish({ok:false,error:'Cannot locate'});await pending;
  assert.equal(errors[0].anchor.exact,'Original selection');assert.equal(errors[0].document.url,'https://example.org/first');
});
