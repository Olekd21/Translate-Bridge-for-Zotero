async page => {
  // Reconstructed translated DOM. English is from the cached Nature paper;
  // Chinese and wrapper placement reproduce the reported class of failure.
  // All Zotero messages are mocked; this does not modify an actual library.
  await page.route('**/*', route => route.continue());
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  const pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on('pageerror', onError);
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const assert = (condition, message) => { if (!condition) throw Error(message); };
    const passed = [], failures = [], observations = [];
    let serial = 0;
    delete globalThis.Translator;
    chrome.runtime.sendMessage = async message => message.type === 'paperbridge:list-annotations'
      ? { ok: true, annotations: [] } : { ok: false, error: 'Empty-marker regression: mocked Zotero is disconnected' };
    const article = document.querySelector('#paper');
    const en = [
      'Among those tested, only IFN-γ increased IL-33 expression.',
      'Consistent with this, previous studies have shown that IFN-γ induces both the cytokine and nuclear forms of IL-33 in epithelial cells25,37.',
      'Interferons have also been reported to inhibit lymphangiogenesis and promote apoptosis in LymphECs38.',
    ];
    const zh = [
      '在检测的细胞因子中，只有IFN-γ增加了IL-33的表达。',
      '与此一致，先前的研究表明，IFN-γ可以诱导上皮细胞中IL-33的细胞因子形式和核形式。',
      '研究还发现，干扰素可以抑制淋巴管生成，并促进淋巴内皮细胞LymphECs发生凋亡。',
    ];
    async function capture(english = en) {
      const p = document.createElement('p'); p.id = 'empty-markers-' + (++serial);
      p.textContent = english.join(' '); article.append(p);
      for (let attempt = 0; attempt < 50 && !p.querySelector('[data-pb-sentence]'); attempt++) await wait(20);
      const spans = [...p.querySelectorAll('[data-pb-sentence]')];
      assert(spans.length === english.length, 'unexpected source segmentation: ' + spans.length);
      return { p, spans };
    }
    function clone(marker, text) {
      const copy = marker.cloneNode(false), font = document.createElement('font');
      font.textContent = text; copy.append(font); return copy;
    }
    function citation(marker, text = '38') {
      const link = document.createElement('a'); link.href = '#ref-CR' + text;
      link.append(clone(marker, text)); return link;
    }
    async function select(p, node = p) {
      const range = document.createRange(); range.selectNodeContents(node);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await wait(100);
      if (document.querySelector('.pb-panel').dataset.open !== 'true') {
        document.querySelector('.pb-selection-button').click(); await wait(100);
      }
      await wait(60);
    }
    async function expectMapped(p, node, english) {
      await select(p, node);
      assert(!document.querySelector('.pb-open-selection').disabled,
        'mapping disabled: ' + document.querySelector('.pb-status').textContent);
      assert(normalize(document.querySelector('.pb-source').textContent) === normalize(english),
        'wrong source: ' + document.querySelector('.pb-source').textContent);
    }
    async function expectRejected(p, node = p) {
      await select(p, node);
      assert(document.querySelector('.pb-open-selection').disabled, 'unsafe input enabled PDF opening');
      assert(document.querySelector('.pb-sync').disabled, 'unsafe input enabled synchronization');
      assert(document.querySelector('.pb-scope-proposal').hidden, 'unsafe input offered source expansion');
    }
    async function check(name, action) {
      try { await action(); passed.push(name); }
      catch (error) { failures.push({ name, error: String(error) }); }
    }
    // Keys have the reported relative order: 234, 233, 232, empty 233,
    // citation 232, terminal 232. Also place the citation after the last stop.
    for (const [label, empty] of [['empty', ''], ['whitespace', ' \n\u00a0'],
      ['literal-empty-sup', '<sup></sup>'], ['literal-open-sup', '<sup>'], ['literal-spaced-sup', '<sup> </sup>']]) {
      for (const referenceAfterStop of [false, true]) {
        const { p, spans } = await capture();
        spans[0].textContent = zh[0]; spans[1].textContent = zh[1]; spans[2].textContent = zh[2].slice(0, -1);
        const phantom = clone(spans[1], empty), ref = citation(spans[2]), stop = clone(spans[2], '。');
        p.replaceChildren(spans[0], spans[1], spans[2], phantom,
          ...(referenceAfterStop ? [stop, ref] : [ref, stop]));
        const labelBase = `${label}, citation ${referenceAfterStop ? 'after' : 'before'} terminal`;
        await check(labelBase + ': earlier complete statement remains usable', () => expectMapped(p, spans[1], en[1]));
        await check(labelBase + ': complete paragraph preserves all source sentences', () => expectMapped(p, p, en.join(' ')));
        p.remove();
      }
    }
    await check('a second complete copy of the previous sentence is not an empty clone', async () => {
      const { p, spans } = await capture();
      spans[0].textContent = zh[0]; spans[1].textContent = zh[1]; spans[2].textContent = zh[2].slice(0, -1);
      p.replaceChildren(spans[0], spans[1], spans[2], clone(spans[1], zh[1]), citation(spans[2]), clone(spans[2], '。'));
      try { await expectRejected(p); } finally { p.remove(); }
    });
    // A genuine A/B/A translator key interleave needs fallback grouping. These
    // cases isolate its handling of citation-only content after sentence stops.
    async function interleaved(tail, appendNextSentence = false) {
      const { p, spans } = await capture();
      const cut = Math.floor(zh[1].length / 2);
      spans[0].textContent = zh[0];
      const pieces = [spans[0], clone(spans[1], zh[1].slice(0, cut)),
        clone(spans[2], zh[1].slice(cut, cut + 2)), clone(spans[1], zh[1].slice(cut + 2))];
      if (appendNextSentence) pieces.push(citation(spans[1], '25'), clone(spans[2], zh[2]));
      else pieces.push(clone(spans[2], zh[2]));
      if (tail === 'reference') pieces.push(citation(spans[2]));
      else if (tail) pieces.push(document.createTextNode(tail));
      p.replaceChildren(...pieces); return p;
    }
    await check('interleaved grouping accepts a reference following an interior Chinese sentence stop', async () => {
      const p = await interleaved('', true);
      try { await expectMapped(p, p, en.join(' ')); } finally { p.remove(); }
    });
    await check('interleaved grouping accepts a real reference after the final Chinese sentence stop', async () => {
      const p = await interleaved('reference');
      try { await expectMapped(p, p, en.join(' ')); } finally { p.remove(); }
    });
    for (const tail of ['38', '未', '%', '−']) {
      await check('interleaved grouping rejects unmarked substantive tail ' + tail, async () => {
        const p = await interleaved(tail);
        try { await expectRejected(p); } finally { p.remove(); }
      });
    }
    await check('numeric comma, time colon and prime clones remain part of the sentence', async () => {
      const english = "The assay measured 2,500 particles at 12:30 and used a 5' probe.";
      const { p, spans } = await capture([english]);
      p.replaceChildren(...['实验测得2', ',', '500颗粒，并在12', ':', '30使用5', "'", '探针。'].map(text => clone(spans[0], text)));
      try { await expectMapped(p, p, english); } finally { p.remove(); }
    });
    // This observation is deliberately not asserted: short substantive A-key
    // text borrowed inside a B-majority translation cannot be distinguished
    // from genuine translation movement using marker majority alone.
    const { p, spans } = await capture();
    spans[0].textContent = zh[0]; spans[1].textContent = zh[1]; spans[2].textContent = zh[2].slice(0, -1);
    p.replaceChildren(spans[0], spans[1], spans[2], clone(spans[1], '新增正文'), citation(spans[2]), clone(spans[2], '。'));
    await select(p);
    observations.push({ name: 'short substantive borrowed-key text', accepted: !document.querySelector('.pb-open-selection').disabled,
      status: document.querySelector('.pb-status').textContent });
    p.remove();
    return { passed, failures, observations, mockedZotero: true };
  });
  page.off('pageerror', onError);
  return { ...result, pageErrors };
}
