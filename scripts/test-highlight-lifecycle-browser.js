export default async page => {
  await page.route('**/*', route => route.continue());
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  return page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const passed = [], calls = [];
    const p = document.createElement('p');
    const text = 'An independently identified cardiac observation stays stable during prolonged reading.';
    p.textContent = text; document.querySelector('#paper').append(p); await wait(150);
    const row = {attachmentID:7,annotationKey:'stable',text,comment:'Initial comment',pageLabel:'1',color:'#ffd400'};
    let rows = [row], delay = 0;
    chrome.runtime.sendMessage = async message => {
      calls.push(message.type);
      if (message.type === 'paperbridge:list-annotations') {
        const snapshot = rows.slice(); await wait(delay); return {ok:true,annotations:snapshot};
      }
      return {ok:true};
    };
    const refresh = () => document.querySelector('.pb-saved-refresh').dispatchEvent(new Event('click'));
    const button = label => [...document.querySelectorAll('.pb-saved-card button')].find(node => node.textContent === label);
    refresh(); await wait(150);
    button('编辑内容').click();
    const card = document.querySelector('.pb-saved-card'), editor = card.querySelector('textarea');
    editor.value = 'Still typing my own note'; editor.dispatchEvent(new Event('input'));
    editor.focus(); editor.setSelectionRange(8, 8);
    delay = 120;
    const count = () => calls.filter(type => type === 'paperbridge:list-annotations').length;
    const before = count();
    for (let i = 0; i < 10; i++) refresh();
    await wait(180);
    if (count()-before !== 1) throw Error('concurrent annotation reads were not shared');
    if (card !== document.querySelector('.pb-saved-card') || editor.selectionStart !== 8 || editor.value !== 'Still typing my own note')
      throw Error('unchanged refresh replaced the editing card or cursor');
    passed.push('concurrent refreshes share one request and preserve the live editor');
    button('取消').click();

    // A hidden paragraph stops being a target; showing it rebuilds the range.
    p.hidden = true; await wait(200);
    if (CSS.highlights.size) throw Error('hidden source kept a highlight');
    p.hidden = false; await wait(200);
    if (CSS.highlights.size !== 1) throw Error('visible source was not reindexed');
    passed.push('visibility changes invalidate and rebuild only the affected source');

    // Local deletion occurs while an earlier read still returns the old row.
    delay = 200; refresh(); await wait(20);
    button('删除批注').click(); await wait(500);
    if (CSS.highlights.size || document.querySelector('.pb-saved-card')) throw Error('stale read resurrected a locally deleted annotation');
    const marker = p.querySelector('[data-pb-sentence]');
    marker.textContent = '独立识别的心脏观察结果在长时间阅读过程中保持稳定。';
    await wait(200);
    if (CSS.highlights.size) throw Error('translated DOM resurrected a deleted annotation');
    passed.push('deletion tombstone survives in-flight reads and translation mutations');
    rows = []; delay = 0; refresh(); await wait(150);
    if (CSS.highlights.size) throw Error('authoritative deletion was lost');

    // New rows after a confirmed deletion can be rendered on demand again.
    rows = [{...row,annotationKey:'new'}]; refresh(); await wait(200);
    if (CSS.highlights.size !== 1) throw Error('new translated annotation did not appear');
    const requestsBefore = count();
    let hidden = true;
    Object.defineProperty(document, 'hidden', {configurable:true,get:()=>hidden});
    Object.defineProperty(document, 'visibilityState', {configurable:true,get:()=>hidden?'hidden':'visible'});
    marker.textContent = '独立识别的心脏观察结果在长时间阅读过程中保持稳定。';
    await wait(180);
    if (count() !== requestsBefore) throw Error('hidden tab requested Zotero due to DOM churn');
    rows = []; hidden = false;
    document.dispatchEvent(new Event('visibilitychange')); await wait(180);
    if (CSS.highlights.size || document.querySelector('.pb-saved-card')) throw Error('returning to the page missed Zotero deletion');
    passed.push('background mutations do not fetch; returning to the page sees authoritative deletion');
    return {passed, listRequests:count()};
  });
};
