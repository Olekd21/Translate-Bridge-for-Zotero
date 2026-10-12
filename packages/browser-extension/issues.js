const list=document.querySelector('#issue-list'),status=document.querySelector('#issue-status');
const names={pending:'待复核',resolved:'已解决',unresolved:'仍有问题',ignored:'暂不处理'};
let records=[];
const drafts=new Map();
const send=async (action,extra={})=>{
  const result=await chrome.runtime.sendMessage({type:'paperbridge:issues',action,...extra});
  if(!result?.ok)throw Error(result?.error || '操作失败');return result;
};
const show=(text,error=false)=>{status.textContent=text;status.classList.toggle('issue-error',error);};
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const when=value=>value?new Date(value).toLocaleString():'未复核';
function render(){
  list.replaceChildren();
  const filter=document.querySelector('#issue-filter').value,search=document.querySelector('#issue-search').value.trim().toLowerCase();
  const visible=records.filter(row=>(filter==='all'||row.status===filter)&&(!search||JSON.stringify([row.latest.document,row.latest.selector.exact,row.latest.message,row.latest.code,row.note]).toLowerCase().includes(search)))
    .sort((a,b)=>b.lastSeen.localeCompare(a.lastSeen));
  show(`共 ${records.length} 条记录 · 当前显示 ${visible.length} 条`);
  if(!visible.length)list.append(node('p',records.length?'没有符合筛选条件的记录。':'还没有问题记录。在文章侧栏点击“记录当前问题”即可保存错误和诊断，无需填写原因。'));
  for(const row of visible){
    const data=row.latest,card=node('article',undefined,'issue-row');card.dataset.issueId=row.id;
    const badge=node('span',names[row.status],'issue-badge');badge.dataset.state=row.status;
    card.append(badge,node('h2',data.document.title||data.document.doi||'论文问题'),
      node('p',`${data.document.doi||'无 DOI'} · 记录 ${row.occurrences} 次 · 首次 ${row.firstVersion} → 最近 ${row.lastVersion}`,'issue-meta'),
      node('p',`首次 ${when(row.firstSeen)} · 最近 ${when(row.lastSeen)}`,'issue-meta'),
      node('p',data.message||data.code),node('blockquote',data.selector.exact||'本条没有选中文字，可重新打开文章核查。'));
    const controls=node('div',undefined,'actions');
    const open=node('button','打开文章并找回位置');open.className='primary';open.disabled=!data.document.url;
    open.onclick=async()=>{open.disabled=true;try{await send('open',{id:row.id});show('文章已打开。若原记录为中文，请启用原来的 Google 翻译，再点击“重新查找位置”。');}catch(e){show(e.message,true);}finally{open.disabled=!data.document.url;}};
    const select=node('select');select.setAttribute('aria-label','复核状态');
    for(const [value,label]of Object.entries(names)){const option=node('option',label);option.value=value;select.append(option);}select.value=drafts.get(row.id)?.status || row.status;
    const save=node('button','保存复核');
    const remove=node('button','删除记录','danger');
    const label=node('label','复核备注'),note=node('textarea');note.value=drafts.get(row.id)?.note ?? row.note;note.maxLength=5000;note.placeholder='例如：更新后已可匹配；或仍存在的问题。';label.append(note);
    note.oninput=select.onchange=()=>drafts.set(row.id,{status:select.value,note:note.value});
    save.onclick=async()=>{save.disabled=true;try{const r=await send('update',{id:row.id,patch:{status:select.value,note:note.value}});Object.assign(row,r.record);drafts.delete(row.id);badge.textContent=names[row.status];badge.dataset.state=row.status;show(`已保存复核结果 · 版本 ${row.reviewVersion}`);}catch(e){show(e.message,true);}finally{save.disabled=false;}};
    remove.onclick=async()=>{if(!confirm('删除这条本地问题记录及复核历史？需要保留时请先导出。'))return;try{await send('delete',{id:row.id});records=records.filter(item=>item.id!==row.id);render();}catch(e){show(e.message,true);}};
    controls.append(open,select,save,remove);card.append(controls,label);
    const details=node('details');details.append(node('summary','诊断与复核历史'),node('pre',JSON.stringify({id:row.id,first:row.first,latest:row.latest,reviews:row.reviews},null,2)));card.append(details);list.append(card);
  }
}
async function load(){records=(await send('list')).records;render();}
document.querySelector('#issue-filter').onchange=render;document.querySelector('#issue-search').oninput=render;
document.querySelector('#export-issues').onclick=async()=>{
  try{const {archive}=await send('export');const url=URL.createObjectURL(new Blob([JSON.stringify(archive,null,2)],{type:'application/json;charset=utf-8'}));
    const link=node('a');link.href=url;link.download=`translate-bridge-issues-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);show(`已导出 ${archive.records.length} 条记录，包含复核状态与备注。`);
  }catch(e){show(e.message,true);}
};
document.querySelector('#import-issues').onclick=()=>document.querySelector('#issue-file').click();
document.querySelector('#issue-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>6*1024*1024)throw Error('文件超过 6 MB，请拆分后导入。');const result=await send('import',{archive:JSON.parse(await file.text())});await load();show(`导入 ${result.added} 条，跳过 ${result.skipped} 条已有记录；本机复核状态未被覆盖。`);}catch(e){show(`导入失败：${e.message}`,true);}finally{event.target.value='';}
};
void load().catch(error=>show(error.message,true));
document.querySelector('#refresh-issues').onclick=()=>void load().catch(error=>show(error.message,true));
window.addEventListener('focus',()=>void load().catch(error=>show(error.message,true)));
document.querySelector('#import-example').onclick=async()=>{
  try{const archive=await(await fetch('reported-issue-1.5.2.json')).json();const result=await send('import',{archive});await load();show(`本次 Nature 案例：导入 ${result.added} 条，已有 ${result.skipped} 条。`);}catch(error){show(error.message,true);}
};
