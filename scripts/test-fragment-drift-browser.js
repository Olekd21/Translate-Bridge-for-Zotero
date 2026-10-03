async (page) => {
  // Reconstructed DOM regression only. Known excerpts below came from the user's
  // diagnostics; completed Flt4/Il33 sentences are deliberately constructed.
  // This is not downloaded Nature HTML or a live Chrome Translate test.
  const errors = [];
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  const result = await page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const passed = [], failures = [], structures = [];
    delete globalThis.Translator;
    const normalize = text => text.replace(/\s+/g, ' ').trim();
    const article = document.getElementById('paper');

    async function check(name, action) {
      try { await action(); passed.push(name); }
      catch (error) { failures.push({ name, error: String(error) }); }
    }

    async function capture(id, english, html = english.join(' ')) {
      const p = document.createElement('p'); p.id = id; p.innerHTML = html;
      article.append(p);
      for (let attempt = 0; attempt < 30 && !p.querySelector('[data-pb-sentence]'); attempt++) await sleep(20);
      const spans = [...p.querySelectorAll('[data-pb-sentence]')];
      if (spans.length !== english.length) throw Error(`capture expected ${english.length} markers, got ${spans.length}`);
      if (normalize(p.textContent) !== english.join(' ')) throw Error('capture changed original English text');
      return { p, spans };
    }

    function replaceWithFragments(span, chunks) {
      const fragments = chunks.map(({ text, tag = 'font', href }) => {
        const wrapper = document.createElement(tag);
        if (href) wrapper.href = href;
        const clone = span.cloneNode(false);
        const translatedFont = document.createElement('font'); translatedFont.textContent = text;
        clone.append(translatedFont);
        wrapper.append(clone); return wrapper;
      });
      const key = span.dataset.pbSentence;
      span.replaceWith(...fragments);
      if (span.isConnected) throw Error('fixture must disconnect the original marked node');
      return { key, fragments };
    }

    function stripInterSentenceWhitespace(p) {
      // Avoid introducing a new space into the Chinese prefix that moved across
      // markers. Chrome can concatenate these text fragments without whitespace.
      for (const node of [...p.childNodes]) if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
    }

    function point(p, offset) {
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node, consumed = 0;
      while ((node = walk.nextNode())) {
        if (offset <= consumed + node.length) return [node, offset - consumed];
        consumed += node.length;
      }
      throw Error(`text offset ${offset} exceeds paragraph length ${consumed}`);
    }

    async function select(p, selected) {
      const start = p.textContent.indexOf(selected);
      if (start < 0) throw Error('requested selected text absent from fixture');
      const end = start + selected.length;
      const [first, from] = point(p, start), [last, to] = point(p, end);
      const range = document.createRange(); range.setStart(first, from); range.setEnd(last, to);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      if (getSelection().toString() !== selected) throw Error('DOM range differs from requested selection');
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(150);
      if (document.querySelector('.pb-panel').dataset.open !== 'true') {
        const button = document.querySelector('.pb-selection-button');
        if (!button) throw Error('selection action missing');
        button.click(); await sleep(150);
      }
      return {
        english: normalize(document.querySelector('.pb-source').textContent),
        disabled: document.querySelector('.pb-open-selection').disabled,
        status: document.querySelector('.pb-status').textContent,
      };
    }

    async function expectMapped(p, text, expected) {
      const actual = await select(p, text);
      if (actual.disabled || actual.english !== normalize(expected)) throw Error(JSON.stringify({ expected, actual }));
    }
    async function expectRejected(p, text) {
      const actual = await select(p, text);
      if (!actual.disabled) throw Error(`unsafe recovery accepted: ${JSON.stringify(actual)}`);
    }
    async function expectRoundtrip(p, english, chinese) {
      // Check actual rendered Highlight ranges, not just a sidebar success label.
      await expectMapped(p, chinese, english);
      const originalSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => message.type === 'paperbridge:list-annotations'
        ? { ok: true, annotations: [{ annotationKey: 'fragment-roundtrip', attachmentID: 991,
          text: english, comment: 'Constructed regression annotation', color: '#ffd400' }] }
        : originalSend(message);
      try {
        document.querySelector('.pb-saved-refresh').click(); await sleep(250);
        const ranges = [...(CSS.highlights.get('pb-saved-0') || [])];
        if (ranges.length !== 1) throw Error(`expected one precise highlight range, got ${ranges.length}`);
        const range = ranges[0];
        if (!p.contains(range.startContainer) || !p.contains(range.endContainer)) throw Error('readback highlighted a different paragraph');
        if (normalize(range.toString()) !== normalize(chinese)) throw Error(JSON.stringify({ expected: chinese, actual: range.toString() }));
        if (!document.querySelector('.pb-saved-card')?.textContent.includes('已定位网页')) throw Error('readback card did not report a mapped quote');
      } finally { chrome.runtime.sendMessage = originalSend; }
    }

    let abstract, results;
    await check('008 fixture: captured original removed; four cloned Flt4 fragments retain the same marker key', async () => {
      const en = [
        'Here we show that aging reduces cardiac lymphatic vessel density in humans and mice and induces structural remodeling characterized by tighter, zipper-like endothelial junctions.',
        'These changes are associated with immune cell infiltration, fibrinogen and amyloid accumulation, and myocardial edema.',
        // Constructed continuation, not claimed to be the user's full selection.
        'Knockdown of Flt4 (VEGFR3) or overexpression of soluble Flt4 reduced cardiac lymphatic vessel density in mice.',
        'These findings suggest a role for lymphatic vessels in cardiac tissue homeostasis.',
      ];
      const zh = [
        '本研究表明，衰老会降低人类和小鼠的心脏淋巴管密度，并诱导以更紧密、拉链状内皮细胞连接为特征的结构重塑。',
        '这些变化与免疫细胞浸润、纤维蛋白原和淀粉样蛋白沉积以及心肌水肿相关。',
        '通过敲低Flt4（VEGFR3）或过表达可溶性Flt4降低小鼠心脏淋巴管密度。',
        '这些发现提示淋巴管参与维持心脏组织稳态。',
      ];
      const { p, spans } = await capture('fragment-drift-008', en,
        en.join(' ').replaceAll('Flt4', '<i>Flt4</i>'));
      spans[0].textContent = zh[0]; spans[1].textContent = zh[1] + '通过敲低'; spans[3].textContent = zh[3];
      const cloned = replaceWithFragments(spans[2], [
        { tag: 'i', text: 'Flt4' }, { text: '（VEGFR3）或过表达可溶性' },
        { tag: 'i', text: 'Flt4' }, { text: '降低小鼠心脏淋巴管密度。' },
      ]);
      stripInterSentenceWhitespace(p);
      if (p.textContent !== zh.join('')) throw Error('008 constructed Chinese text mismatch');
      const copies = p.querySelectorAll(`[data-pb-sentence="${cloned.key}"]`).length;
      if (copies !== 4) throw Error(`008 expected four clones, got ${copies}`);
      structures.push({ issue: '008', copies, disconnectedOriginal: !spans[2].isConnected, constructedContinuation: true });
      abstract = { p, en, zh, spans, key: cloned.key };
    });
    if (abstract) {
      const { p, en, zh } = abstract;
      for (let i = 0; i < zh.length; i++) await check(`008 sentence ${i + 1}`, () => expectMapped(p, zh[i], en[i]));
      await check('008 adjacent sentences preserve both sources', () => expectMapped(p, zh[1] + zh[2], en[1] + ' ' + en[2]));
      await check('008 full paragraph preserves all four sources', () => expectMapped(p, zh.join(''), en.join(' ')));
      await check('008 incomplete shifted prefix is not expanded to a full sentence', () => expectRejected(p, '通过敲低'));
      await check('008 incomplete gene sentence is not expanded', () => expectRejected(p, zh[2].slice(0, -8)));
      await check('008 English annotation roundtrip restores exactly the Flt4 sentence including its drifted prefix', () => expectRoundtrip(p, en[2], zh[2]));
      await check('008 two-sentence English annotation roundtrip excludes both surrounding Chinese sentences', () => expectRoundtrip(p, en[1] + ' ' + en[2], zh[1] + zh[2]));
    }

    await check('014 fixture: one English sentence becomes two Chinese sentences; IL-33 drifts before five cloned fragments', async () => {
      const en = [
        'Among the top upregulated genes, we found complement factor H (CFH), which is a key regulator of the alternative pathway of the complement system, and the cytokine interleukin-33 (IL-33).',
        // Constructed full sentence based on the diagnostic fragment and figure.
        'Il33 expression was specifically enriched in aged lymphatic endothelial cells (LymphECs) (Fig. 4d).',
        'Immunostaining confirmed that IL-33 protein expression increased in sixteen-month-old lymphatic endothelial cells (Fig. 4e).',
      ];
      const zh = [
        '在显著上调的基因中，我们发现了补体因子H (CFH) 和细胞因子白细胞介素-33 (IL-33)。CFH是补体系统旁路途径的关键调节因子。',
        'IL -33的表达在衰老的淋巴内皮细胞(LymphECs)中特异性富集（图4d）。',
        '免疫染色证实，十六个月龄淋巴内皮细胞中IL-33蛋白表达增加（图4e）。',
      ];
      const { p, spans } = await capture('fragment-drift-014', en);
      spans[0].textContent = zh[0] + 'IL -33'; spans[2].textContent = zh[2];
      const cloned = replaceWithFragments(spans[1], [
        { tag: 'i', text: '' }, { text: '的' },
        { text: '表达在衰老的淋巴内皮细胞(LymphECs)中特异性富集（图' },
        { tag: 'a', href: '#fig-4', text: '4d' }, { text: '）。' },
      ]);
      stripInterSentenceWhitespace(p);
      if (p.textContent !== zh.join('')) throw Error('014 constructed Chinese text mismatch');
      const copies = p.querySelectorAll(`[data-pb-sentence="${cloned.key}"]`).length;
      if (copies !== 5) throw Error(`014 expected five clones, got ${copies}`);
      structures.push({ issue: '014', copies, disconnectedOriginal: !spans[1].isConnected, constructedContinuation: true });
      results = { p, en, zh, spans, key: cloned.key };
    });
    if (results) {
      const { p, en, zh } = results;
      await check('014 complete source sentence spanning two Chinese sentences excludes next IL-33', () => expectMapped(p, zh[0], en[0]));
      await check('014 IL-33 sentence spans drifted prefix, clones and figure link', () => expectMapped(p, zh[1], en[1]));
      await check('014 following intact sentence remains correct', () => expectMapped(p, zh[2], en[2]));
      await check('014 adjacent source sentences do not duplicate source text', () => expectMapped(p, zh[0] + zh[1], en[0] + ' ' + en[1]));
      await check('014 entire paragraph remains complete', () => expectMapped(p, zh.join(''), en.join(' ')));
      await check('014 incomplete shifted IL-33 prefix and Chinese continuation are refused', () => expectRejected(p, 'IL -33的表达'));
      await check('014 truncated sentence before figure link is refused', () => expectRejected(p, zh[1].slice(0, -6)));
      await check('014 English annotation roundtrip restores exactly the IL-33 sentence and figure link', () => expectRoundtrip(p, en[1], zh[1]));
      await check('014 adjacent English annotations roundtrip includes two-to-one Chinese rendering without the following sentence', () => expectRoundtrip(p, en[0] + ' ' + en[1], zh[0] + zh[1]));

      await check('unknown key inside a selected paragraph cannot bypass validation', async () => {
        const copy = p.querySelector(`[data-pb-sentence="${results.key}"]`).cloneNode(false);
        copy.dataset.pbSentence = 'unknown-fragment-record'; copy.textContent = '这句话没有已缓存的英文依据。'; p.append(copy);
        try { await expectRejected(p, p.textContent); } finally { copy.remove(); }
      });
      await check('same key copied to a foreign paragraph cannot borrow source ownership', async () => {
        const foreign = document.createElement('p');
        foreign.append(...[...p.childNodes].map(node => node.cloneNode(true))); article.append(foreign); await sleep(80);
        try { await expectRejected(foreign, foreign.textContent); } finally { foreign.remove(); }
      });
    }

    await check('duplicate full-sentence clones are not treated as one fragmented sentence', async () => {
      const en = ['Lymphatic vessels contribute to immune surveillance and fluid balance in the heart.'];
      const { p, spans } = await capture('fragment-drift-duplicate', en);
      const text = '淋巴管参与心脏的免疫监视并维持组织液平衡。';
      const first = spans[0].cloneNode(false), second = spans[0].cloneNode(false);
      first.textContent = text; second.textContent = text; spans[0].replaceWith(first, second);
      await expectRejected(p, text);
    });

    const negativeEnglish = [
      'Lymphatic endothelial cells regulate tissue fluid balance in the adult heart.',
      'Cardiac inflammation was assessed with independent molecular measurements.',
      'Further experiments compared vascular permeability between experimental groups.',
    ];
    const negativeChinese = [
      '淋巴内皮细胞调控成年心脏的组织液平衡。',
      '研究通过独立的分子检测评估心脏炎症。',
      '后续实验比较了不同实验组的血管通透性。',
    ];
    async function negativeBlock(name) {
      const block = await capture(`fragment-negative-${name}`, negativeEnglish);
      block.spans.forEach((span, i) => span.textContent = negativeChinese[i]);
      stripInterSentenceWhitespace(block.p); return block;
    }
    await check('reordered source markers cannot produce a cached original-order paragraph', async () => {
      const { p, spans } = await negativeBlock('reorder');
      p.insertBefore(spans[1], spans[0]);
      await expectRejected(p, p.textContent);
    });
    await check('a repeated key interrupted by another key cannot masquerade as a contiguous fragment group', async () => {
      const { p, spans } = await negativeBlock('interrupted');
      const first = spans[0].cloneNode(false), last = spans[0].cloneNode(false);
      const split = 8;
      first.textContent = negativeChinese[0].slice(0, split);
      last.textContent = negativeChinese[0].slice(split);
      spans[0].replaceWith(first); spans[1].after(last);
      await expectRejected(p, p.textContent);
    });
    await check('translation collapsed into a preceding marker with an empty next marker is refused', async () => {
      const { p, spans } = await negativeBlock('collapsed');
      spans[0].textContent = negativeChinese[0] + negativeChinese[1];
      spans[1].textContent = '';
      await expectRejected(p, negativeChinese[1]);
    });
    await check('unmarked substantive Chinese text between valid groups prevents whole-paragraph recovery', async () => {
      const { p, spans } = await negativeBlock('uncovered');
      const unmarked = document.createElement('font'); unmarked.textContent = '这一段新增正文没有缓存的英文依据。';
      spans[0].after(unmarked);
      await expectRejected(p, p.textContent);
    });

    await check('unmarked content in one fragment group does not disable a different intact sentence', async () => {
      const en = ['Independent measurements confirmed the vascular findings.', 'IL-33 regulates fibrosis and inflammation in the heart.'];
      const zh = ['独立测量证实了血管变化。', 'IL-33调节心脏纤维化和炎症。'];
      const {p,spans}=await capture('fragment-local-failure',en);
      spans[0].textContent=zh[0];
      const {fragments}=replaceWithFragments(spans[1],[{text:'IL-33调节心脏纤维化'},{text:'和炎症。'}]);
      fragments[0].after(document.createTextNode('无法对应的新增正文'));
      await expectMapped(p,zh[0],en[0]);
      await expectRejected(p,p.textContent);
    });

    await check('111 citation-rich IL-33 group: ten physical clones, reference wrappers and drifted prefix', async () => {
      const en=['Measurements confirmed the change in the heart.', 'IL-33 is a cytokine belonging to the IL-1 family, which regulates fibrosis, inflammation and angiogenesis.', 'The subsequent experiment tested the nuclear protein.'];
      const {p,spans}=await capture('marker111-reconstruction',en);
      spans[0].textContent='测量证实了心脏中的变化。IL';spans[2].textContent='随后的实验检测了核蛋白。';
      const chunks=[{text:'-33是IL-1家族的细胞因子，可调节纤维化'},{text:'20',tag:'a',href:'#ref-CR20'},{text:'、炎症'}, {text:''},
        {text:'21',tag:'a',href:'#ref-CR21'},{text:'、'},{text:'22',tag:'a',href:'#ref-CR22'},{text:'和血管生成'}, {text:'23',tag:'a',href:'#ref-CR23'},{text:'。'}];
      const {fragments}=replaceWithFragments(spans[1],chunks);
      for(const index of [1,4,6,8]){const sup=document.createElement('sup');fragments[index].replaceWith(sup);sup.append(fragments[index]);}
      stripInterSentenceWhitespace(p);
      const selected='IL-33是IL-1家族的细胞因子，可调节纤维化20、炎症21、22和血管生成23。';
      await expectMapped(p,selected,en[1]);
      await expectMapped(p,'测量证实了心脏中的变化。',en[0]);
      await expectMapped(p,p.textContent,en.join(' '));
      await expectRejected(p,'IL-33是IL-1家族的细胞因子，可调节纤维化');
    });

    await check('numeric gene continuation cannot match a longer source identifier by substring', async () => {
      const en=['Measurements confirmed the change in the heart.', 'IL-330 regulates fibrosis and inflammation in cardiac tissue.'];
      const {p,spans}=await capture('numeric-gene-negative',en);
      spans[0].textContent='测量证实了心脏中的变化。IL';spans[1].textContent='-33调节心脏组织的纤维化和炎症。';
      stripInterSentenceWhitespace(p);
      await expectRejected(p,'IL-33调节心脏组织的纤维化和炎症。');
    });

    let splitRecipient;
    await check('008 recipient fixture: one English target has two Chinese sentences plus a drifted opening', async () => {
      // Constructed two-sentence Chinese rendering: the second sentence carries
      // the mouse context from the same English sentence, not a second source.
      const en = [
        'These changes are associated with immune cell infiltration, fibrinogen and amyloid accumulation, and myocardial edema.',
        'Knockdown of Flt4 (VEGFR3) or overexpression of soluble Flt4 decreased lymphatic vessel density in experimental mouse hearts.',
        'Independent measurements supported the observed vascular alterations.',
      ];
      const zh = [
        '这些变化与免疫细胞浸润、纤维蛋白原和淀粉样蛋白沉积以及心肌水肿相关。',
        '通过敲低Flt4（VEGFR3）或过表达可溶性Flt4，心脏淋巴管密度下降。这一变化见于实验小鼠。',
        '独立测量支持观察到的血管改变。',
      ];
      const { p, spans } = await capture('fragment-drift-008-split-recipient', en);
      spans[0].textContent = zh[0] + '通过敲低'; spans[2].textContent = zh[2];
      const cloned = replaceWithFragments(spans[1], [
        { tag: 'i', text: 'Flt4' }, { text: '（VEGFR3）或过表达可溶性' },
        { tag: 'i', text: 'Flt4' }, { text: '，心脏淋巴管密度下降。这一变化见于实验小鼠。' },
      ]);
      stripInterSentenceWhitespace(p);
      if (p.textContent !== zh.join('')) throw Error('008 split recipient constructed Chinese mismatch');
      const copies = p.querySelectorAll(`[data-pb-sentence="${cloned.key}"]`).length;
      if (copies !== 4) throw Error(`008 split recipient expected four clones, got ${copies}`);
      structures.push({ issue: '008-split-recipient', copies, disconnectedOriginal: !spans[1].isConnected,
        targetChineseSentences: 2, targetEnglishSentences: 1, constructedContinuation: true });
      splitRecipient = { p, en, zh };
    });
    if (splitRecipient) {
      const { p, en, zh } = splitRecipient;
      await check('008 split recipient: preceding sentence excludes the target opening', () => expectMapped(p, zh[0], en[0]));
      await check('008 split recipient: both Chinese target sentences restore one English source', () => expectRoundtrip(p, en[1], zh[1]));
      await check('008 split recipient: preceding plus complete target roundtrip excludes following source', () => expectRoundtrip(p, en[0] + ' ' + en[1], zh[0] + zh[1]));
      await check('008 split recipient: incomplete clause still cannot expand to the whole English target', () => expectRejected(p, '通过敲低Flt4（VEGFR3）'));
    }
    return {
      total: passed.length + failures.length, passed, failures, structures,
      scope: 'Constructed translation DOM reproductions for diagnostic issues 008/014; supplied excerpts are retained, missing full Flt4/Il33 selections and nearby sentences are constructed. No live Google translation, Nature HTML, or Zotero PDF lookup is asserted.',
    };
  });
  page.off('pageerror', onError);
  return { ...result, errors };
}
