async (page) => {
  // Reconstructs the user's 96/95/94 diagnostic with original English captured
  // by content.js before translating the DOM. No live translation or Zotero
  // writes occur. Caller-owned routing may replace content.js with a baseline.
  const pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  // Routing disables the HTTP cache; fallback preserves any caller-owned
  // content.js baseline route regardless of which handler was registered last.
  const bypassBrowserCache = route => route.fallback();
  page.on('pageerror', onError);
  try {
    await page.route('**/*', bypassBrowserCache);
    await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
    await page.addStyleTag({ url: 'http://127.0.0.1:18841/packages/browser-extension/content.css' });
    const result = await page.evaluate(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const compact = value => normalize(value).replace(/\s/g, '');
      const assert = (condition, message) => { if (!condition) throw Error(message); };
      const passed = [], failures = [], observations = [], requests = [];
      async function check(name, action) {
        try { await action(); passed.push(name); }
        catch (error) { failures.push({ name, error: String(error) }); }
      }
      delete globalThis.Translator;
      chrome.runtime.sendMessage = async message => {
        requests.push(message.type);
        if (message.type === 'paperbridge:list-annotations') return { ok: true, annotations: [] };
        return { ok: false, error: 'Compound-prefix fixture: Zotero is disconnected' };
      };
      const english = [
        'To assess whether a direct reduction in lymphatic vessels can induce age-related cardiac phenotypes, we conditionally deleted Flt4, which encodes the essential lymphatic receptor VEGFR3, in lymphatic ECs (LymphECs) of young mice (referred to as Vegfr3iΔLEC).',
        'Cre-negative littermates served as controls (referred to as Vegfr3fl/fl).',
        'At 1 month after deletion, we observed a significant decline of LYVE-1+ and PDPN+ lymphatic vessel density in the heart (Fig. 3a), which was associated with an increase of CD68+ macrophages (Fig. 3b) and fibrinogen (Fig. 3c).',
      ];
      const chinese = [
        '为了评估淋巴管直接减少是否能诱导与年龄相关的心脏表型，我们条件性地敲除了幼鼠淋巴内皮细胞（LymphECs）中的Flt4基因（编码必需的淋巴受体VEGFR3），并将小鼠标记为Vegfr3 iΔLEC 。',
        'Cre阴性同窝小鼠作为对照（标记为Vegfr3 fl/fl ）。',
        '敲除1个月后，我们观察到心脏中LYVE-1 + 和PDPN + 淋巴管密度显著下降（图3a），并伴有CD68 + 巨噬细胞（图3b）和纤维蛋白原（图3c）的增加。',
      ];
      let index = 0;
      async function capture(name, source, prefix = 'Cre', cloned = false) {
        const p = document.createElement('p'); p.id = `compound-prefix-${++index}`;
        p.textContent = source.join(' '); document.getElementById('paper').append(p);
        for (let i = 0; i < 50 && !p.querySelector('[data-pb-sentence]'); i++) await wait(20);
        const spans = [...p.querySelectorAll('[data-pb-sentence]')];
        assert(spans.length === 3, `${name}: expected three original markers, got ${spans.length}`);
        assert(normalize(p.textContent) === source.join(' '), `${name}: capture changed the English text`);
        spans.forEach((span, i) => assert(normalize(span.textContent) === source[i], `${name}: marker ${i + 1} has an incorrect English boundary`));
        const target = prefix + chinese[1].slice(3);
        const translated = [chinese[0] + prefix, chinese[1].slice(3), chinese[2]];
        const clones = [];
        spans.forEach((span, i) => {
          if (!cloned) { span.textContent = translated[i]; return; }
          const chunks = i === 0
            ? [chinese[0].slice(0, 48), chinese[0].slice(48), prefix]
            : i === 1 ? [translated[i].slice(0, 13), translated[i].slice(13)]
              : [translated[i].slice(0, 28), translated[i].slice(28, 52), translated[i].slice(52)];
          const key = span.dataset.pbSentence;
          span.replaceWith(...chunks.map(text => {
            const wrapper = document.createElement('font'), marker = span.cloneNode(false);
            const inner = document.createElement('font'); inner.textContent = text;
            marker.append(inner); wrapper.append(marker); return wrapper;
          }));
          assert(!span.isConnected, `${name}: original marker was not disconnected`);
          clones.push({ key, copies: p.querySelectorAll(`[data-pb-sentence="${key}"]`).length });
        });
        for (const node of [...p.childNodes])
          if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
        assert(p.textContent === chinese[0] + target + chinese[2], `${name}: drifted Chinese reconstruction differs`);
        observations.push({ name, source, cloned, clones });
        await wait(60);
        return { p, source, target };
      }
      function point(p, offset) {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let text, consumed = 0;
        while ((text = walker.nextNode())) {
          if (offset <= consumed + text.length) return [text, offset - consumed];
          consumed += text.length;
        }
        throw Error(`selection offset ${offset} exceeds paragraph length ${consumed}`);
      }
      function proposalVisible() {
        const node = document.querySelector('.pb-scope-proposal');
        return Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none');
      }
      async function select(p, selected) {
        const at = p.textContent.indexOf(selected);
        assert(at >= 0, 'requested Chinese selection is absent from the fixture');
        const range = document.createRange();
        range.setStart(...point(p, at)); range.setEnd(...point(p, at + selected.length));
        getSelection().removeAllRanges(); getSelection().addRange(range);
        assert(getSelection().toString() === selected, 'DOM range differs from the requested selection');
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await wait(140);
        if (document.querySelector('.pb-panel').dataset.open !== 'true') {
          document.querySelector('.pb-selection-button').click(); await wait(140);
        }
        await wait(100);
        return {
          english: normalize(document.querySelector('.pb-source').textContent),
          chinese: normalize(document.querySelector('.pb-translation').textContent),
          openDisabled: document.querySelector('.pb-open-selection').disabled,
          syncDisabled: document.querySelector('.pb-sync').disabled,
          proposalVisible: proposalVisible(),
          status: document.querySelector('.pb-status').textContent,
        };
      }
      async function mapped(p, selected, expected) {
        const actual = await select(p, selected);
        assert(!actual.openDisabled && !actual.syncDisabled, JSON.stringify({ expected, actual }));
        assert(actual.english === normalize(expected), JSON.stringify({ expected, actual }));
        assert(compact(actual.chinese) === compact(selected), 'complete Chinese preview changed the selected scope');
        assert(!actual.proposalVisible, 'complete scope unexpectedly requires expansion');
      }
      async function rejected(p, selected) {
        const actual = await select(p, selected);
        assert(actual.openDisabled && actual.syncDisabled, 'unsafe compound-prefix match accepted: ' + JSON.stringify(actual));
        assert(!actual.proposalVisible, 'unsupported prefix received an expansion proposal');
        const before = requests.filter(type => type === 'paperbridge:sync').length;
        document.querySelector('.pb-sync').click(); await wait(20);
        assert(requests.filter(type => type === 'paperbridge:sync').length === before, 'rejected selection attempted synchronization');
      }
      async function latinWordDoesNotExpand(p) {
        const actual = await select(p, 'Cre');
        assert(!actual.proposalVisible, 'Latin word selection unexpectedly received a whole-sentence proposal');
        if (!actual.openDisabled || !actual.syncDisabled)
          assert(actual.english === 'Cre', 'Latin word silently expanded beyond the selected Cre: ' + JSON.stringify(actual));
      }

      for (const cloned of [false, true]) {
        const name = cloned ? 'cloned translated fragments' : 'original marker nodes';
        let fixture;
        await check(`${name}: reconstruct reported 96/95/94 compound-prefix drift`, async () => {
          fixture = await capture(name, english, 'Cre', cloned);
        });
        if (!fixture) continue;
        const { p } = fixture;
        for (const [start, end] of [[0, 1], [1, 2], [2, 3], [0, 2], [1, 3], [0, 3]])
          await check(`${name}: sentences ${start + 1}-${end} map to exactly their originals`,
            () => mapped(p, chinese.slice(start, end).join(''), english.slice(start, end).join(' ')));
        await check(`${name}: Latin Cre selection never silently expands to the compound sentence`, () => latinWordDoesNotExpand(p));
        await check(`${name}: partial Cre-negative Chinese sentence remains blocked`,
          () => rejected(p, 'Cre阴性同窝小鼠'));
        await check(`${name}: whole second sentence remains correct after partial rejection`,
          () => mapped(p, chinese[1], english[1]));
        p.remove();
      }

      const negatives = [
        { name: 'Cre cannot match the longer leading component Creb', prefix: 'Cre',
          second: 'Creb-negative littermates served as controls (referred to as Vegfr3fl/fl).' },
        { name: 'Cre-negative later in the sentence cannot justify a drifted leading Cre', prefix: 'Cre',
          second: 'Matched Cre-negative littermates served as controls (referred to as Vegfr3fl/fl).' },
        { name: 'single-letter C cannot match the leading component Cre', prefix: 'C', second: english[1] },
      ];
      for (const item of negatives) {
        await check(item.name, async () => {
          const fixture = await capture(item.name, [english[0], item.second, english[2]], item.prefix, true);
          try { await rejected(fixture.p, fixture.target); }
          finally { fixture.p.remove(); }
        });
      }
      await check('compound-prefix regression never attempts a Zotero mutation', async () => {
        assert(!requests.some(type => ['paperbridge:sync', 'paperbridge:mutate-annotation', 'paperbridge:article-notes'].includes(type)),
          'unexpected mutation request was attempted');
      });
      return { passed, failures, observations, version: globalThis.__paperBridgeVersion,
        evidence: 'User diagnostic 96/95/94 rebuilt from original English with synthetic negative controls',
        realChromeTranslateUsed: false, realZoteroUsed: false };
    });
    return { ...result, pageErrors };
  } finally {
    page.off('pageerror', onError);
    await page.unroute('**/*', bypassBrowserCache);
  }
}
