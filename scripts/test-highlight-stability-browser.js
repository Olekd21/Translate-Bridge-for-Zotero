export default async page => {
  await page.route('**/*', route => route.continue());
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    let calls = 0, walks = 0;
    const treeWalker = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => { walks++; return treeWalker(...args); };
    const host = document.createElement('section');
    const rows = [];
    for (let i = 0; i < 100; i++) {
      const p = document.createElement('p');
      p.textContent = `Sample ${i} retains a distinct cardiac lymphatic observation with normal tissue fluid balance.`;
      host.append(p);
      if (i < 20) rows.push({attachmentID:1,annotationKey:`A${i}`,text:p.textContent,comment:'note',color:'#ffd400',pageLabel:'1'});
    }
    document.querySelector('#paper').append(host);
    const banner = document.createElement('aside'); banner.textContent = '计数 0'; document.body.append(banner);
    await wait(200);
    let delay = 0, failure = false;
    chrome.runtime.sendMessage = async message => {
      if (message.type !== 'paperbridge:list-annotations') return {ok:true};
      calls++; await wait(delay);
      return failure ? {ok:false,error:'Zotero offline'} : {ok:true,annotations:rows.slice()};
    };
    const refresh = () => document.querySelector('.pb-saved-refresh').click();
    refresh(); await wait(500);
    const initial = {calls, walks, highlights:CSS.highlights.size};
    const firstCard = document.querySelector('.pb-saved-card');
    let missingSamples = 0;
    for (let i = 0; i < 8; i++) {
      banner.firstChild.data = `计数 ${i + 1}`;
      await wait(100);
      if (CSS.highlights.size !== 20) missingSamples++;
    }
    await wait(1000);
    const bannerResult = {calls:calls-initial.calls, walks:walks-initial.walks, missingSamples,
      sameCard:firstCard===document.querySelector('.pb-saved-card')};
    const before = {calls,walks};
    // An unrelated body paragraph still changes; update one index entry only.
    host.lastElementChild.textContent = '最后一个段落已翻译，包含其他正文。';
    await wait(1000);
    const changed = {calls:calls-before.calls,walks:walks-before.walks,highlights:CSS.highlights.size};
    // Network failure must not erase verified, unchanged page highlights.
    failure = true; delay = 100; refresh(); await wait(300);
    const offline = {highlights:CSS.highlights.size,cards:document.querySelectorAll('.pb-saved-card').length,
      status:document.querySelector('.pb-saved-status').textContent};
    // A successful authoritative empty list does remove them.
    failure = false; rows.length = 0; refresh(); await wait(300);
    const deleted = {highlights:CSS.highlights.size,cards:document.querySelectorAll('.pb-saved-card').length};
    return {initial,bannerResult,changed,offline,deleted};
  });
  const {initial,bannerResult,changed,offline,deleted} = result;
  if (initial.highlights !== 20 || initial.walks > 400) throw Error('initial index must be shared across annotations: '+JSON.stringify(result));
  if (bannerResult.calls || bannerResult.walks || bannerResult.missingSamples || !bannerResult.sameCard)
    throw Error('unrelated DOM updates must preserve highlights and cards without network or text scanning: '+JSON.stringify(result));
  if (changed.calls || changed.walks > 4 || changed.highlights !== 20) throw Error('changed paragraphs must be updated locally: '+JSON.stringify(result));
  if (offline.highlights !== 20 || offline.cards !== 20 || !offline.status.includes('offline')) throw Error('offline refresh lost saved state');
  if (deleted.highlights || deleted.cards) throw Error('confirmed deletion was retained');
  return result;
};
