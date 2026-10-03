async (page) => {
  // Diagnostic-derived reconstruction through the real content script. Chrome
  // Translate and Zotero are not called. A caller may route content.js to a
  // baseline before invoking this function; both old and corrected marker
  // layouts are retained so a segmentation failure does not skip mapping tests.
  const pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on('pageerror', onError);
  try {
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
        return { ok: false, error: 'Abbreviation regression fixture: Zotero is disconnected' };
      };
      const english = [
        'In addition, IL-33 has a dual function: it acts both as a classic extracellular cytokine and as a higher-weight nuclear factor.',
        'This higher-molecular-weight isoform, often referred to as nuclear IL-33 (nIL-33), was shown to interfere with NF-kB and act as chromatin regulator23.',
        'Interestingly, RNA sequencing (RNA-seq) analysis of isolated cardiac ECs2 revealed elevated expression of the nuclear Il33 isoform, which contains the nuclear localization sequence encoded by exon 3 in samples from aged mouse hearts (Extended Data Fig. 4).',
        'Consistently, immunostainings predominantly showed an accumulation of nIL-33 in lymphatics of the aging heart (Fig. 4f).',
      ];
      const chinese = [
        '此外，IL-33具有双重功能：它既是经典的细胞外细胞因子，也是高分子量核因子。',
        '这种高分子量亚型，通常被称为核IL-33 (nIL-33)，已被证实能够干扰NF-κB并作为染色质调节因子发挥作用 23 。',
        '有趣的是，对分离的心脏内皮细胞(EC)进行RNA测序(RNA-seq)分析发现，在老年小鼠心脏样本中，含有由外显子3编码的核定位序列的核IL-33亚型表达升高（扩展数据图4）。',
        '与此一致的是，免疫染色结果显示，nIL-33主要在老年心脏的淋巴管中积累（图4f）。',
      ];
      const prefix = '有趣的是，对分离的心脏内皮细胞(EC)';
      const p = document.createElement('p');
      p.id = 'reported-abbreviation-boundaries';
      p.textContent = english.join(' ');
      document.getElementById('paper').append(p);
      let ready = false;
      await check('diagnostic fixture captures real source markers and clones translated fragments', async () => {
        for (let i = 0; i < 50 && !p.querySelector('[data-pb-sentence]'); i++) await wait(20);
        const spans = [...p.querySelectorAll('[data-pb-sentence]')];
        assert(spans.length > 0, 'content script did not capture English sentences');
        assert(normalize(p.textContent) === english.join(' '), 'capturing markers changed the source text');
        const originalMarkers = spans.map(span => ({ key: span.dataset.pbSentence, english: normalize(span.textContent) }));
        observations.push({ initialMarkers: originalMarkers });
        const find = text => spans.find(span => normalize(span.textContent) === text);
        const before = find(english[0]), current = find(english[1]), following = find(english[3]);
        const complete = find(english[2]);
        const abbreviated = find(english[2].slice(0, -4));
        const figure = find('4).');
        assert(before && current && following, 'neighboring original sentences were not independently captured');
        assert(complete || (abbreviated && figure), 'unrecognized source marker layout around Extended Data Fig. 4');
        assert(spans.length === (complete ? 4 : 5), 'unexpected extra source markers');
        const replace = (span, chunks) => {
          const key = span.dataset.pbSentence;
          const clones = chunks.map(chunk => {
            const item = typeof chunk === 'string' ? { text: chunk } : chunk;
            const wrapper = document.createElement(item.tag || 'font');
            if (item.href) wrapper.setAttribute('href', item.href);
            const clone = span.cloneNode(false), translated = document.createElement('font');
            translated.textContent = item.text; clone.append(translated); wrapper.append(clone);
            if (item.citation) {
              const sup = document.createElement('sup'); sup.append(wrapper); return sup;
            }
            return wrapper;
          });
          span.replaceWith(...clones);
          assert(!span.isConnected, 'fixture retained the original marker node');
          return { key, copies: p.querySelectorAll(`[data-pb-sentence="${key}"]`).length };
        };
        const cloneGroups = [];
        cloneGroups.push(replace(before, [chinese[0].slice(0, 17), chinese[0].slice(17)]));
        cloneGroups.push(replace(current, [
          '这种高分子量亚型，通常被称为核IL-33 (nIL-33)，',
          '已被证实能够干扰NF-κB并作为染色质调节因子发挥作用 ',
          { text: '23', tag: 'a', href: '#ref-CR23', citation: true },
          ' 。' + prefix,
        ]));
        const mainChunks = ['进行RNA测序(RNA-seq)分析发现，', '在老年小鼠心脏样本中，',
          '含有由外显子3编码的', '核定位序列的核IL-33亚型', '表达升高', '（扩展数据图'];
        const figureChunks = [{ text: '4', tag: 'a', href: '#Fig4' }, '）', '。'];
        if (complete) cloneGroups.push(replace(complete, [...mainChunks, ...figureChunks]));
        else {
          cloneGroups.push(replace(abbreviated, mainChunks));
          cloneGroups.push(replace(figure, figureChunks));
        }
        cloneGroups.push(replace(following, ['与此一致的是，免疫染色结果显示，', 'nIL-33主要在老年心脏的淋巴管中积累',
          '（图', { text: '4f）。', tag: 'a', href: '#Fig4' }]));
        for (const node of [...p.childNodes])
          if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
        assert(p.textContent === chinese.join(''), 'translated reconstruction differs from the diagnostic wording');
        observations.push({ layout: complete ? 'complete-figure-sentence' : 'legacy-split-figure-sentence', cloneGroups });
        ready = true;
        await wait(80);
        await check('Extended Data Fig. 4 stays inside one captured English sentence', async () => {
          assert(Boolean(complete), 'source sentence was split between Fig. and 4).');
        });
      });

      function point(offset) {
        const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let text, consumed = 0;
        while ((text = walk.nextNode())) {
          if (offset <= consumed + text.length) return [text, offset - consumed];
          consumed += text.length;
        }
        throw Error(`selection offset ${offset} exceeds ${consumed}`);
      }
      function visible(selector) {
        const node = document.querySelector(selector);
        return Boolean(node && !node.hidden && getComputedStyle(node).display !== 'none');
      }
      async function select(selected) {
        const at = p.textContent.indexOf(selected);
        assert(at >= 0, 'requested selection is absent from reconstructed Chinese');
        const range = document.createRange();
        range.setStart(...point(at)); range.setEnd(...point(at + selected.length));
        getSelection().removeAllRanges(); getSelection().addRange(range);
        assert(getSelection().toString() === selected, 'browser selection differs from the requested text');
        p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await wait(140);
        if (document.querySelector('.pb-panel').dataset.open !== 'true') {
          document.querySelector('.pb-selection-button').click(); await wait(140);
        }
        await wait(100);
        return {
          english: normalize(document.querySelector('.pb-source').textContent),
          chinese: normalize(document.querySelector('.pb-translation').textContent),
          openDisabled: document.querySelector('.pb-open-selection').disabled,
          syncDisabled: document.querySelector('.pb-sync').disabled,
          proposalVisible: visible('.pb-scope-proposal'),
          status: document.querySelector('.pb-status').textContent,
        };
      }
      async function mapped(selected, expected) {
        const actual = await select(selected);
        assert(!actual.openDisabled && !actual.syncDisabled, JSON.stringify({ expected, actual }));
        assert(actual.english === normalize(expected), JSON.stringify({ expected, actual }));
        assert(compact(actual.chinese) === compact(selected), 'Chinese preview changed the requested complete sentence scope');
        assert(!actual.proposalVisible, 'complete original scope unnecessarily requires expansion');
      }
      async function safePartial(selected, expectedEnglish, expectedChinese) {
        const actual = await select(selected);
        assert(actual.openDisabled && actual.syncDisabled, 'partial selection silently enabled PDF opening or sync: ' + JSON.stringify(actual));
        if (actual.proposalVisible) {
          assert(normalize(document.querySelector('.pb-scope-original').textContent) === normalize(expectedEnglish),
            'explicit expansion proposes an incorrect English sentence scope');
          assert(compact(document.querySelector('.pb-scope-translation').textContent) === compact(expectedChinese),
            'explicit expansion proposes an incorrect Chinese sentence scope');
          assert(visible('.pb-use-source-sentence'), 'expansion has no explicit acceptance control');
        }
        const sent = requests.filter(type => type === 'paperbridge:sync').length;
        document.querySelector('.pb-sync').click(); await wait(20);
        assert(requests.filter(type => type === 'paperbridge:sync').length === sent, 'partial selection sent a sync request without explicit acceptance');
      }
      if (ready) {
        for (let i = 0; i < chinese.length; i++)
          await check(`complete Chinese sentence ${i + 1} maps to exactly its original`, () => mapped(chinese[i], english[i]));
        for (const [start, end] of [[0, 2], [1, 3], [2, 4], [1, 4], [0, 4]])
          await check(`adjacent Chinese sentences ${start + 1}-${end} preserve their complete English union`,
            () => mapped(chinese.slice(start, end).join(''), english.slice(start, end).join(' ')));
        await check('drifted opening clause alone never silently expands', () => safePartial(prefix, english[2], chinese[2]));
        await check('middle sentence missing its drifted opening never silently expands',
          () => safePartial(chinese[2].slice(prefix.length), english[2], chinese[2]));
        await check('middle sentence without figure-number tail never silently expands',
          () => safePartial(chinese[2].slice(0, -3), english[2], chinese[2]));
        await check('middle sentence without the entire figure reference never silently expands',
          () => safePartial(chinese[2].slice(0, chinese[2].indexOf('（扩展数据图')), english[2], chinese[2]));
        await check('half a middle sentence never silently expands',
          () => safePartial(chinese[2].slice(0, chinese[2].indexOf('含有')), english[2], chinese[2]));
        await check('figure number and closing punctuation alone never silently expands',
          () => safePartial('4）。', english[2], chinese[2]));
        await check('preceding sentence plus an unfinished next sentence never silently expands',
          () => safePartial(chinese[1] + prefix, english[1] + ' ' + english[2], chinese[1] + chinese[2]));
        await check('complete selection after rejected fragments clears stale scope', () => mapped(chinese[2], english[2]));
      }
      await check('regression never contacts Zotero or sends an annotation mutation', async () => {
        assert(!requests.some(type => ['paperbridge:sync', 'paperbridge:mutate-annotation', 'paperbridge:article-notes'].includes(type)),
          'an unexpected mutation request was attempted');
      });
      return { passed, failures, observations, version: globalThis.__paperBridgeVersion,
        evidence: 'Diagnostic-derived DOM reconstruction through the actual content script; external baseline routing supported',
        realChromeTranslateUsed: false, realZoteroUsed: false };
    });
    return { ...result, pageErrors };
  } finally {
    page.off('pageerror', onError);
  }
}
