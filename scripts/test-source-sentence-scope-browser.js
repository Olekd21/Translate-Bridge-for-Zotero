async (page) => {
  // Reconstructed DOM + real extension interaction. Translator and Zotero are
  // absent or replaced with in-page test doubles; this never writes a library.
  // CFH wording is the user's diagnostic; other disciplines are synthetic.
  const pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on('pageerror', onError);
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  await page.addStyleTag({ url: 'http://127.0.0.1:18841/packages/browser-extension/content.css' });
  const result = await page.evaluate(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
    const compactDisplay = text => normalize(text).replace(/\s/g, '');
    const visible = selector => {
      const node = document.querySelector(selector);
      return Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none');
    };
    const assert = (value, message) => { if (!value) throw Error(message); };
    const passed = [], failures = [], requests = [];
    let annotations = [], fixtureIndex = 0;
    delete globalThis.Translator;
    chrome.runtime.sendMessage = async message => {
      requests.push(message);
      if (message.type === 'paperbridge:list-annotations') return { ok: true, annotations };
      return { ok: false, error: 'Scope regression: Zotero is intentionally disconnected' };
    };
    const article = document.getElementById('paper');
    async function check(name, action) {
      try { await action(); passed.push(name); }
      catch (error) { failures.push({ name, error: String(error) }); }
    }
    async function capture(english) {
      const p = document.createElement('p');
      p.id = `general-scope-${++fixtureIndex}`;
      p.textContent = english.join(' '); article.append(p);
      for (let i = 0; i < 50 && !p.querySelector('[data-pb-sentence]'); i++) await wait(20);
      const spans = [...p.querySelectorAll('[data-pb-sentence]')];
      assert(spans.length === english.length, `expected ${english.length} source markers, got ${spans.length}`);
      assert(normalize(p.textContent) === english.join(' '), 'marking changed the English source');
      for (const node of [...p.childNodes])
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
      return { p, spans };
    }
    function point(node, offset) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let text, consumed = 0;
      while ((text = walker.nextNode())) {
        if (offset <= consumed + text.length) return [text, offset - consumed];
        consumed += text.length;
      }
      throw Error(`offset ${offset} exceeds ${consumed}`);
    }
    async function selectBetween(startElement, start, endElement, end) {
      const first = point(startElement, start), last = point(endElement, end);
      const range = document.createRange(); range.setStart(...first); range.setEnd(...last);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const actual = getSelection().toString();
      startElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await wait(120);
      if (document.querySelector('.pb-panel').dataset.open !== 'true') {
        document.querySelector('.pb-selection-button').click();
        await wait(120);
      }
      await wait(120);
      return actual;
    }
    async function select(p, selected) {
      const at = p.textContent.indexOf(selected);
      assert(at >= 0, 'selected text is absent from paragraph');
      const actual = await selectBetween(p, at, p, at + selected.length);
      assert(actual === selected, `wrong DOM selection: ${actual}`);
    }
    function expectReady(english, chinese) {
      assert(!document.querySelector('.pb-open-selection').disabled, 'PDF opening is still disabled');
      assert(!document.querySelector('.pb-sync').disabled, 'synchronization is still disabled');
      assert(normalize(document.querySelector('.pb-source').textContent) === normalize(english),
        'English source does not match the complete original sentence(s)');
      assert(compactDisplay(document.querySelector('.pb-translation').textContent) === compactDisplay(chinese),
        'Chinese preview does not cover the same complete sentence(s)');
    }
    function expectProposal(english, chinese) {
      assert(visible('.pb-scope-proposal'), 'complete source sentence proposal is missing');
      assert(document.querySelector('.pb-open-selection').disabled, 'partial selection silently enabled PDF opening');
      assert(document.querySelector('.pb-sync').disabled, 'partial selection silently enabled synchronization');
      assert(normalize(document.querySelector('.pb-scope-original')?.textContent) === normalize(english),
        'proposal English preview does not match the precise full source scope');
      assert(compactDisplay(document.querySelector('.pb-scope-translation')?.textContent) === compactDisplay(chinese),
        'proposal Chinese preview does not match the full translated scope');
      assert(visible('.pb-use-source-sentence'), 'explicit source-sentence action is absent');
    }
    async function confirmProposal(english, chinese, initialSelection) {
      document.querySelector('.pb-use-source-sentence').click(); await wait(150);
      expectReady(english, chinese);
      assert(!visible('.pb-scope-proposal'), 'accepted proposal remained actionable');
      assert(visible('.pb-scope-notice'), 'persistent scope-change explanation disappeared');
      assert(compactDisplay(document.querySelector('.pb-scope-notice').textContent).includes(compactDisplay(initialSelection)),
        'persistent explanation does not retain the original selection');
    }
    async function expectPayload(english, chinese) {
      const before = requests.filter(item => item.type === 'paperbridge:sync').length;
      const notice = visible('.pb-scope-notice') ? document.querySelector('.pb-scope-notice').textContent : null;
      document.querySelector('.pb-sync').click(); await wait(100);
      const syncRequests = requests.filter(item => item.type === 'paperbridge:sync');
      assert(syncRequests.length === before + 1, 'sync did not send exactly one mocked request');
      const payload = syncRequests.at(-1).annotation;
      assert(normalize(payload.selector.exact) === normalize(english), 'sync payload English differs from preview');
      assert(compactDisplay(payload.translation) === compactDisplay(chinese), 'sync payload Chinese differs from preview');
      assert(payload.commit === true, 'sync test did not exercise the real synchronization handler');
      if (notice !== null) {
        assert(visible('.pb-scope-notice'), 'synchronization status hid the persistent scope explanation');
        assert(document.querySelector('.pb-scope-notice').textContent === notice,
          'synchronization status changed the original selection or scope explanation');
      }
    }
    async function expectRoundtrip(p, english, chinese) {
      annotations = [{ annotationKey: 'scope-roundtrip', attachmentID: 9043, text: english,
        comment: chinese, color: '#ffd400', pageLabel: '4' }];
      document.querySelector('.pb-saved-refresh').click(); await wait(150);
      const ranges = [...(CSS.highlights.get('pb-saved-0') || [])];
      assert(ranges.length === 1, `expected one exact readback range, got ${ranges.length}`);
      assert(p.contains(ranges[0].startContainer) && p.contains(ranges[0].endContainer), 'readback targeted another paragraph');
      assert(compactDisplay(ranges[0].toString()) === compactDisplay(chinese), 'readback highlighted an incomplete or extra Chinese range');
      assert(document.querySelector('.pb-saved-card')?.textContent.includes('已定位网页'), 'readback location was not reported');
      annotations = [];
    }
    async function expectRejected(p, selected) {
      await select(p, selected);
      assert(document.querySelector('.pb-open-selection').disabled, 'unsafe selection enabled PDF opening');
      assert(document.querySelector('.pb-sync').disabled, 'unsafe selection enabled synchronization');
      assert(!visible('.pb-scope-proposal'), 'unsafe selection received a scope proposal');
    }

    const cfh = {
      name: 'reported CFH reordered relative clause',
      en: 'Among the top upregulated genes, we found complement factor H (CFH), which is a key regulator of the alternative pathway of the complement system, and the cytokine interleukin-33 (IL-33).',
      zh: ['在显著上调的基因中，我们发现了补体因子H (CFH) 和细胞因子白细胞介素-33 (IL-33)。', 'CFH是补体系统旁路途径的关键调节因子。'],
    };
    const astronomy = {
      name: 'astronomy semicolon without figure references',
      en: 'The telescope detected 12 candidate planets; however, only 4 candidates had independent confirmation.',
      zh: ['望远镜探测到了12颗候选行星。', '然而，只有4颗候选行星获得了独立确认。'],
    };
    const matrix = [cfh, {
      name: 'materials reordered relative clause',
      en: 'The polymer, which remains stable at 40 °C, retained 80% of its tensile strength after treatment.',
      zh: ['处理后，该聚合物保留了80%的抗拉强度。', '这种聚合物在40 °C时保持稳定。'],
    }, astronomy, {
      name: 'computing three clauses',
      en: 'Although the training set contained only 200 images, the classifier reached 92% accuracy, while the baseline reached 75% accuracy.',
      zh: ['训练集仅包含200张图像。', '该分类器仍达到了92%的准确率。', '基线模型的准确率为75%。'],
    }, {
      name: 'ecology negated opening',
      en: 'Irrigation did not increase seedling survival, but it increased root biomass and reduced soil temperature.',
      zh: ['灌溉并未提高幼苗存活率。', '但它增加了根系生物量并降低了土壤温度。'],
    }];
    for (const item of matrix) {
      const { p, spans } = await capture([item.en]);
      spans[0].textContent = item.zh.join('');
      for (let start = 0; start < item.zh.length; start++) {
        for (let end = start + 1; end <= item.zh.length; end++) {
          const selected = item.zh.slice(start, end).join('');
          const whole = start === 0 && end === item.zh.length;
          await check(`${item.name}: Chinese sentences ${start + 1}-${end}`, async () => {
            await select(p, selected);
            if (whole) {
              expectReady(item.en, item.zh.join(''));
              assert(!visible('.pb-scope-proposal'), 'whole source scope needlessly requires confirmation');
              assert(!visible('.pb-scope-notice'), 'new whole selection retained a stale scope notice');
            } else {
              expectProposal(item.en, item.zh.join(''));
              const before = requests.filter(value => value.type === 'paperbridge:sync').length;
              document.querySelector('.pb-sync').click(); await wait(20);
              assert(requests.filter(value => value.type === 'paperbridge:sync').length === before,
                'proposal sent data before explicit selection of the full-sentence action');
              await confirmProposal(item.en, item.zh.join(''), selected);
              await expectPayload(item.en, item.zh.join(''));
            }
          });
        }
      }
      await check(`${item.name}: complete source readback`, () => expectRoundtrip(p, item.en, item.zh.join('')));
      const chineseCharacters = [...item.zh[0].matchAll(/\p{Script=Han}/gu)];
      const truncated = item.zh[0].slice(0, chineseCharacters.at(-3).index);
      await check(`${item.name}: selection missing substantive sentence tail remains blocked`, () => expectRejected(p, truncated));
      await check(`${item.name}: complete content without Chinese full stop still gets an explicit proposal`, async () => {
        const selected = item.zh[0].slice(0, -1);
        await select(p, selected);
        expectProposal(item.en, item.zh.join(''));
        await confirmProposal(item.en, item.zh.join(''), selected);
        await expectPayload(item.en, item.zh.join(''));
      });
      await check(`${item.name}: missing beginning remains blocked`, () => expectRejected(p, item.zh[0].slice(2)));
      p.remove();
    }

    const nextEn = 'Il33 expression was specifically enriched in aged LymphECs (Fig. 4d).';
    const nextZh = 'IL -33 的表达在衰老的淋巴内皮细胞(LymphECs)中特异性富集（图4d）。';
    await check('cloned CFH fragments and following IL -33 prefix drift retain the precise source scope', async () => {
      const { p, spans } = await capture([cfh.en, nextEn]);
      const copy = (index, text, tag = 'font') => {
        const wrap = document.createElement(tag), marker = spans[index].cloneNode(false);
        marker.textContent = text; wrap.append(marker); return wrap;
      };
      p.replaceChildren(copy(0, cfh.zh[0].slice(0, 20)), copy(0, cfh.zh[0].slice(20)),
        copy(0, cfh.zh[1] + 'IL -33'), copy(1, nextZh.slice('IL -33'.length)));
      try {
        await select(p, cfh.zh[0]); expectProposal(cfh.en, cfh.zh.join(''));
        await confirmProposal(cfh.en, cfh.zh.join(''), cfh.zh[0]);
        await expectPayload(cfh.en, cfh.zh.join(''));
        await expectRoundtrip(p, cfh.en, cfh.zh.join(''));
        await select(p, nextZh); expectReady(nextEn, nextZh);
        assert(!visible('.pb-scope-proposal'), 'unaffected following complete sentence got a proposal');
      } finally { p.remove(); }
    });
    await check('selection crossing source markers proposes their complete union exactly once', async () => {
      const { p, spans } = await capture([cfh.en, nextEn]);
      spans[0].textContent = cfh.zh.join(''); spans[1].textContent = nextZh;
      try {
        const selected = cfh.zh[1] + nextZh, english = cfh.en + ' ' + nextEn, chinese = cfh.zh.join('') + nextZh;
        await select(p, selected); expectProposal(english, chinese);
        await confirmProposal(english, chinese, selected);
        await expectPayload(english, chinese); await expectRoundtrip(p, english, chinese);
      } finally { p.remove(); }
    });
    await check('two selected paragraphs preserve both complete English and Chinese scopes', async () => {
      const one = await capture([cfh.en]), two = await capture([astronomy.en]);
      one.spans[0].textContent = cfh.zh.join(''); two.spans[0].textContent = astronomy.zh.join('');
      try {
        const selected = await selectBetween(one.p, cfh.zh[0].length, two.p, astronomy.zh[0].length);
        const english = cfh.en + ' ' + astronomy.en, chinese = cfh.zh.join('') + astronomy.zh.join('');
        expectProposal(english, chinese); await confirmProposal(english, chinese, selected);
        await expectPayload(english, chinese);
      } finally { one.p.remove(); two.p.remove(); }
    });
    await check('unmarked substantive insertion cannot receive a whole-source proposal', async () => {
      const { p, spans } = await capture([cfh.en]);
      spans[0].textContent = cfh.zh.join('');
      p.insertBefore(document.createTextNode('没有。'), spans[0]);
      try { await expectRejected(p, p.textContent); }
      finally { p.remove(); }
    });
    await check('markers cloned from a different owner remain blocked despite a matching translator', async () => {
      const owner = await capture([cfh.en]), wrong = await capture([astronomy.en]);
      const clone = owner.spans[0].cloneNode(false); clone.textContent = cfh.zh.join('');
      wrong.p.replaceChildren(clone);
      let translatorCalls = 0;
      globalThis.Translator = { availability: async () => 'available', create: async () => ({
        translate: async () => { translatorCalls++; return cfh.zh.join(''); },
      }) };
      try {
        await expectRejected(wrong.p, cfh.zh[0]);
        assert(translatorCalls === 0, 'translator was consulted despite invalid marker ownership');
      } finally { owner.p.remove(); wrong.p.remove(); delete globalThis.Translator; }
    });
    await check('changing the active selection clears any previous scope proposal', async () => {
      const one = await capture([cfh.en]), two = await capture([nextEn]);
      one.spans[0].textContent = cfh.zh.join(''); two.spans[0].textContent = nextZh;
      try {
        await select(one.p, cfh.zh[0]); expectProposal(cfh.en, cfh.zh.join(''));
        await select(two.p, nextZh); expectReady(nextEn, nextZh);
        assert(!visible('.pb-scope-proposal'), 'stale proposal remains visible');
        document.querySelector('.pb-use-source-sentence')?.click(); await wait(100);
        expectReady(nextEn, nextZh);
      } finally { one.p.remove(); two.p.remove(); }
    });
    await check('rematching a confirmed scope preserves original selection and complete bilingual scope', async () => {
      const { p, spans } = await capture([cfh.en]); spans[0].textContent = cfh.zh.join('');
      try {
        await select(p, cfh.zh[0]); expectProposal(cfh.en, cfh.zh.join(''));
        await confirmProposal(cfh.en, cfh.zh.join(''), cfh.zh[0]);
        const notice = document.querySelector('.pb-scope-notice').textContent;
        document.querySelector('.pb-translate').click(); await wait(200);
        expectReady(cfh.en, cfh.zh.join(''));
        assert(visible('.pb-scope-notice'), 'rematching removed the confirmed scope explanation');
        assert(document.querySelector('.pb-scope-notice').textContent === notice, 'rematching lost the original selection explanation');
        await expectPayload(cfh.en, cfh.zh.join(''));
      } finally { p.remove(); }
    });
    let pointerProbe = null;
    try {
      const { p, spans } = await capture([cfh.en]); spans[0].textContent = cfh.zh.join('');
      await select(p, cfh.zh[0]); expectProposal(cfh.en, cfh.zh.join(''));
      pointerProbe = { english: cfh.en, chinese: cfh.zh.join(''), original: cfh.zh[0], id: p.id };
    } catch (error) { failures.push({ name: 'real pointer activation of full-source proposal', error: 'setup: ' + String(error) }); }
    return { passed, failures, mockedSyncRequests: requests.filter(item => item.type === 'paperbridge:sync').length,
      realTranslatorUsed: false, realZoteroUsed: false, pointerProbe };
  });
  if (result.pointerProbe) {
    try {
      await page.getByRole('button', { name: '按完整英文原句定位', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.pb-open-selection').disabled);
      await page.evaluate(expected => {
        const compact = value => String(value || '').replace(/\s/g, '');
        if (compact(document.querySelector('.pb-source').textContent) !== compact(expected.english)) throw Error('real pointer click chose the wrong English scope');
        if (compact(document.querySelector('.pb-translation').textContent) !== compact(expected.chinese)) throw Error('real pointer click chose the wrong Chinese scope');
        if (!compact(document.querySelector('.pb-scope-notice').textContent).includes(compact(expected.original))) throw Error('real pointer click lost original selection');
        document.getElementById(expected.id)?.remove();
      }, result.pointerProbe);
      result.passed.push('real pointer activation of full-source proposal');
    } catch (error) { result.failures.push({ name: 'real pointer activation of full-source proposal', error: String(error) }); }
  }
  delete result.pointerProbe;
  page.off('pageerror', onError);
  return { ...result, pageErrors };
}
