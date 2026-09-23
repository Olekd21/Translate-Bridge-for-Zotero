import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';

const background = await readFile('packages/browser-extension/background.js','utf8');
const content = await readFile('packages/browser-extension/content.js','utf8');
function backgroundHarness({token='test', status=200, pending=false, payload}={}) {
  const storage={pairingToken:token,outbox:[],reviewArchive:[]};
  const timers=new Map(); let counter=0, requests=0;
  const noop=()=>{};
  const context=vm.createContext({AbortController,Error,Date,console,
    setTimeout(fn){timers.set(++counter,fn);return counter;},clearTimeout(id){timers.delete(id);},
    chrome:{storage:{local:{async get(){return storage;},async set(data){Object.assign(storage,data);}}},
      action:{setBadgeBackgroundColor:noop,setBadgeText:noop,setTitle:noop,onClicked:{addListener:noop}},
      runtime:{onInstalled:{addListener:noop},onMessage:{addListener:noop}}},
    fetch:async (_url,{signal})=>{
      requests++;
      if(pending) return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
      return {ok:status===200,status,text:async()=>JSON.stringify(payload || {ok:status===200})};
    }});
  vm.runInContext(background,context);
  return {context,storage,timers,requests:()=>requests};
}

test('hanging sync aborts, reports uncertain result, and is not silently queued for duplicate retry',async()=>{
  const h=backgroundHarness({pending:true});
  const result=vm.runInContext('syncAnnotation({id:"one"})',h.context);
  await new Promise(setImmediate);
  assert.equal(h.timers.size,1);
  [...h.timers.values()][0]();
  const response=await result;
  assert.equal(response.queued,false);
  assert.match(response.error,/保存结果尚不确定/);
  assert.equal(h.storage.outbox.length,0);
  assert.equal(h.timers.size,0);
});

test('missing pairing and HTTP 4xx fail without an outbox entry; transient failure retains the note',async()=>{
  for (const options of [{token:''},{status:401},{status:503}]) {
    const h=backgroundHarness(options);
    const result=await vm.runInContext('syncAnnotation({id:"one"})',h.context);
    assert.equal(result.queued,options.status===503);
    assert.equal(h.storage.outbox.length,options.status===503?1:0);
    assert.equal(h.timers.size,0);
  }
});
test('legacy HTTP 200 without a highlight is not counted as sync or removed from outbox',async()=>{
  const h=backgroundHarness({payload:{ok:true,nativePdfHighlightCreated:false,error:'no match'}});
  const response=await vm.runInContext('syncAnnotation({id:"one"})',h.context);
  assert.equal(response.ok,false);assert.equal(response.queued,false);
  h.storage.outbox=[{annotation:{id:'pending'},reason:'offline'}];
  const retry=await vm.runInContext('retryOutbox()',h.context);
  assert.equal(retry.synced,0);assert.equal(retry.remaining,1);
  assert.equal(h.storage.outbox[0].annotation.id,'pending');
});

function uiHarness(functionName) {
  const start=content.indexOf(`  async function ${functionName}(`);
  const end=content.indexOf('\n  async function ',start+5);
  const source=content.slice(start,end);
  const state={anchor:{exact:'original'},translation:'译文',color:'#ffd400'};
  let resolve; let requests=0;
  const messages=[];
  const context=vm.createContext({state,Date,Error,
    setTimeout:()=>1,clearTimeout:()=>{},
    syncButton:{disabled:false},openSelectionButton:{disabled:false},noteNode:{value:'note'},
    isPdfAnchorReady:()=>true,selectionPayload:()=>({selector:{exact:state.anchor.exact}}),
    setStatus:(text)=>messages.push(text),
    chrome:{runtime:{sendMessage:()=>{requests++;return new Promise(r=>{resolve=r;});}}}});
  vm.runInContext(source,context);
  return {state,messages,run:()=>vm.runInContext(`${functionName}()`,context),resolve:r=>resolve(r),requests:()=>requests};
}

for (const name of ['syncAnnotation','openSelectionInZotero']) {
  test(`${name}: repeat action sends once; late response cannot replace a newly selected paragraph`,async()=>{
    const h=uiHarness(name);
    const pending=h.run();await h.run();assert.equal(h.requests(),1);
    h.state.anchor={exact:'new selection'};
    h.resolve({ok:true,nativePdfHighlightCreated:true,attachmentID:1,annotationKey:'old',match:{pageLabel:'2'}});
    await pending;
    assert.equal(h.state.openTarget,undefined);
    assert.equal(h.messages.length,1);
    assert.equal(Boolean(h.state.syncing||h.state.locating),false);
  });
}
