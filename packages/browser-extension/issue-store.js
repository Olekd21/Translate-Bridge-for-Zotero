// Local-only evidence archive. One writer (the service worker), no network.
export const ISSUE_KEY = 'paperbridgeIssuesV1';
const FORMAT = 'translate-bridge-issues';
const STATUSES = new Set(['pending', 'resolved', 'unresolved', 'ignored']);
let work = Promise.resolve();
const limit = (value, size = 20000) => String(value ?? '').slice(0, size);
const secret = /token|password|credential|authorization|cookie|api.?key|pairing/i;

export function issueURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = url.password = '';
    for (const name of [...url.searchParams.keys()]) if (secret.test(name)) url.searchParams.delete(name);
    if (/^#pb-(web|issue)=/.test(url.hash)) url.hash = '';
    return url.href;
  } catch { return ''; }
}

function clean(value, depth = 0) {
  if (depth > 9) return '[depth limit]';
  if (typeof value === 'string') return limit(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 120).map(item => clean(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secret.test(key) && !['__proto__','constructor','prototype'].includes(key))
    .slice(0, 100).map(([key, item]) => [key, /url/i.test(key) ? issueURL(item) : clean(item, depth + 1)]));
  return null;
}

function evidence(input) {
  const document = input.document || {}, selector = input.selector || {};
  const result = {
    version:limit(input.version,40), category:limit(input.category || 'mapping',80),
    code:limit(input.code || input.diagnostic?.blocks?.find(block => block.reason !== 'captured')?.reason || 'unknown',100),
    message:limit(input.message,2000),
    document:{url:issueURL(document.url), doi:limit(document.doi,200), title:limit(document.title,500)},
    selector:{exact:limit(selector.exact), prefix:limit(selector.prefix,300), suffix:limit(selector.suffix,300),
      paragraph:limit(selector.paragraph), english:limit(selector.english),
      containerId:limit(selector.containerId,300), sectionHeading:limit(selector.sectionHeading,500)},
    diagnostic:clean(input.diagnostic || {}),
    textTruncated:[selector.exact,selector.paragraph,selector.english].some(value=>String(value || '').length>20000),
  };
  if (!result.document.url && result.document.doi.startsWith('10.'))
    result.document.url = issueURL(`https://doi.org/${result.document.doi}`);
  // Preserve long evidence through export/import; reject rather than silently
  // throwing away diagnostics when the bounded per-record size is exceeded.
  if (JSON.stringify(result).length > 90000) throw Error('该条诊断过大，请先复制诊断单独保存。');
  return result;
}

async function fingerprint(item) {
  const url = issueURL(item.document.url).split('#')[0];
  const key = JSON.stringify([url,item.document.doi,item.selector.exact.replace(/\s+/g,''),item.code,
    ['unknown','manual','settings-error'].includes(item.code) ? item.message : '']);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function load() {
  const data = (await chrome.storage.local.get({[ISSUE_KEY]:{schemaVersion:1,records:[]}}))[ISSUE_KEY];
  if (data?.schemaVersion !== 1 || !Array.isArray(data.records)) throw Error('问题记录格式异常，请先备份扩展本地数据。');
  return data;
}
async function save(data) {
  if (data.records.length > 500 || new TextEncoder().encode(JSON.stringify(data)).length > 4 * 1024 * 1024)
    throw Error('问题记录已达本地容量上限；请导出备份后删除已完成记录，再保存。已有记录不会自动清除。');
  await chrome.storage.local.set({[ISSUE_KEY]:data});
}

function serialized(action) {
  const next=work.then(action,action);work=next.catch(()=>{});return next;
}
function statusUpdate(record, patch, version) {
  if (patch.status !== undefined && !STATUSES.has(patch.status)) throw Error('未知复核状态');
  if (patch.status !== undefined) record.status=patch.status;
  if (patch.note !== undefined) record.note=limit(patch.note,5000);
  record.reviewedAt=new Date().toISOString();
  record.reviewVersion=version;
  record.reviews.push({at:record.reviewedAt,version,status:record.status,note:record.note});
  if (record.reviews.length > 100) throw Error('此记录复核历史已达上限，请导出备份后另建记录。');
}

export async function issueAction(message) {
  return serialized(async () => {
    const data=await load(), version=chrome.runtime.getManifest().version;
    const action=message.action || 'list';
    if (action === 'list') return {ok:true,records:data.records};
    if (action === 'export') return {ok:true,archive:{format:FORMAT,schemaVersion:1,exportedAt:new Date().toISOString(),version,records:data.records}};
    if (action === 'record') {
      const item=evidence(message.issue || {}), key=await fingerprint(item), now=new Date().toISOString();
      let record=data.records.find(row=>row.fingerprint===key);
      if (record) {
        record.lastSeen=now;record.occurrences++;
        record.lastVersion=item.version || version;record.latest=item;
        if (!record.versions.includes(record.lastVersion)) record.versions.push(record.lastVersion);
        if (record.status==='resolved') record.status='unresolved';
      } else {
        record={id:crypto.randomUUID(),fingerprint:key,firstSeen:now,lastSeen:now,occurrences:1,
          firstVersion:item.version || version,lastVersion:item.version || version,versions:[item.version || version],
          status:'pending',note:'',reviews:[],first:item,latest:item};
        data.records.push(record);
      }
      await save(data);return {ok:true,id:record.id,occurrences:record.occurrences};
    }
    if (action === 'update') {
      const record=data.records.find(row=>row.id===message.id);
      if (!record) throw Error('问题记录已不存在');
      statusUpdate(record,message.patch || {},version);await save(data);return {ok:true,record};
    }
    if (action === 'delete') {
      data.records=data.records.filter(row=>row.id!==message.id);await save(data);return {ok:true};
    }
    if (action === 'import') {
      const archive=message.archive;
      if (archive?.format!==FORMAT || archive.schemaVersion!==1 || !Array.isArray(archive.records) || archive.records.length>500)
        throw Error('请选择本插件导出的问题记录 JSON 文件（版本 1）');
      let added=0,skipped=0;
      for (const incoming of archive.records) {
        const first=evidence(incoming.first || incoming.latest || {}),latest=evidence(incoming.latest || first);
        const key=await fingerprint(first);
        if (data.records.some(row=>row.fingerprint===key)) {skipped++;continue;}
        const timestamp=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():new Date().toISOString();
        const date=timestamp(incoming.firstSeen);
        const id=/^[a-zA-Z0-9-]{8,80}$/.test(incoming.id || '') && !data.records.some(row=>row.id===incoming.id)?incoming.id:crypto.randomUUID();
        data.records.push({id,fingerprint:key,firstSeen:date,lastSeen:timestamp(incoming.lastSeen || date),
          occurrences:Math.max(1,Math.min(1e9,Number(incoming.occurrences)||1)),
          firstVersion:first.version,lastVersion:latest.version,versions:[...new Set([first.version,latest.version])],
          status:STATUSES.has(incoming.status)?incoming.status:'pending',note:limit(incoming.note,5000),
          reviews:(Array.isArray(incoming.reviews)?incoming.reviews:[]).slice(0,100).map(review=>({
            at:timestamp(review.at),version:limit(review.version,40),status:STATUSES.has(review.status)?review.status:'pending',note:limit(review.note,5000)})),
          reviewedAt:incoming.reviewedAt?timestamp(incoming.reviewedAt):undefined,reviewVersion:limit(incoming.reviewVersion,40),first,latest});
        added++;
      }
      await save(data);return {ok:true,added,skipped};
    }
    throw Error('未知问题记录操作');
  });
}

export async function openIssue(id) {
  const record=(await load()).records.find(row=>row.id===id);
  if (!record) throw Error('问题记录已不存在');
  const url=issueURL(record.latest.document.url);
  if (!url) throw Error('此记录没有可打开的论文网址');
  // Save before navigation so a fast content script cannot miss the request.
  const tab=await chrome.tabs.create({url:'about:blank'});
  try {
    await chrome.storage.session.set({[`paperbridgeIssueTab:${tab.id}`]:{id,url}});
    await chrome.tabs.update(tab.id,{url});
  } catch(error) {await chrome.tabs.remove(tab.id);throw error;}
  return {ok:true};
}

export async function issueForTab(sender) {
  if (!sender.tab?.id) return {ok:true,record:null};
  const key=`paperbridgeIssueTab:${sender.tab.id}`;
  const pending=(await chrome.storage.session.get(key))[key];
  if (!pending || issueURL(sender.url).split('#')[0]!==pending.url.split('#')[0]) return {ok:true,record:null};
  return {ok:true,record:(await load()).records.find(row=>row.id===pending.id) || null};
}
