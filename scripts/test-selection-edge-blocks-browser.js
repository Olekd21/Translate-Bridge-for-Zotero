async page => {
  // Read-only DOM audit. All text below is constructed. The unknown two
  // characters from the user's report are NOT inferred or reproduced here.
  // A short block is never discarded merely because of its character count.
  await page.route('**/*', route => route.continue());
  const cases = [
    { name: 'verified inline bibliography reference remains harmless', mode: 'inline-reference', mapped: true },
    { name: 'verified bibliography reference in its own block uses the same filtering rule', mode: 'reference-block', mapped: true },
    { name: 'unknown two-character substantive block must remain blocking', mode: 'short-body', mapped: false },
    { name: 'unlinked two-digit block cannot be assumed to be a citation', mode: 'short-number', mapped: false },
    { name: 'figure-number link cannot be discarded as a bibliography reference', mode: 'figure-link', mapped: false },
    { name: 'native button label must not become a scientific source quote', mode: 'button-only', mapped: false },
    { name: 'editable text must not become a scientific source quote', mode: 'editable-only', mapped: false },
    { name: 'an ordinary scientific hyperlink remains substantive text', mode: 'entity-link', mapped: false },
    { name: 'external reference-ranges URL cannot turn a numeric value into a citation', mode: 'external-range-link', mapped: false },
    { name: 'same-page reference-ranges target cannot turn a numeric value into a citation', mode: 'local-range-link', mapped: false },
    { name: 'complete prose sentence remains usable beside an unselected Copy button', mode: 'inline-button-prose', mapped: true },
    { name: 'selection crossing prose and its Copy button must be blocked', mode: 'inline-button-crossed', mapped: false },
    { name: 'ordinary diagnostic redacts grouped-fragment coveredText and rangeText', mode: 'fragment-diagnostic', mapped: false },
  ];
  const passed = [], failures = [], evidence = [], pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on('pageerror', onError);
  for (const item of cases) {
    await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
    try {
      const result = await page.evaluate(async item => {
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const assert = (condition, message) => { if (!condition) throw Error(message); };
        const en = 'The treatment increased endothelial barrier resistance in the cardiac tissue60.';
        const zh = '该处理增加了心脏组织内皮屏障的电阻。';
        delete globalThis.Translator;
        chrome.runtime.sendMessage = async () => ({ ok: false, error: 'Edge-block audit: Zotero is disconnected' });
        let report;
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: async text => { report = JSON.parse(text); },
        } });
        const article = document.querySelector('#paper');
        const fixture = document.createElement('section'); article.append(fixture);
        const p = document.createElement('p'); p.textContent = en;
        // The control must already exist before initial English capture. Adding
        // it after capture would not exercise overbroad container exclusion.
        if (item.mode.startsWith('inline-button-')) {
          const copy = document.createElement('button'); copy.textContent = 'Copy';
          p.append(document.createTextNode(' '), copy);
        }
        fixture.append(p);
        for (let i = 0; i < 30 && !p.querySelector('[data-pb-sentence]'); i++) await sleep(20);
        const span = p.querySelector('[data-pb-sentence]');
        assert(span, 'source paragraph was not captured'); span.textContent = zh;
        let selectionStart = p, selectionEnd = p;
        const reference = () => {
          const sup = document.createElement('sup'), a = document.createElement('a');
          a.href = '#edge-reference-60'; a.setAttribute('role', 'doc-noteref'); a.textContent = '60';
          sup.append(a); return sup;
        };
        const bibliography = document.createElement('ol'); bibliography.setAttribute('role', 'doc-bibliography');
        bibliography.innerHTML = '<li id="edge-reference-60" role="doc-biblioentry">Constructed reference record for the regression fixture.</li>';
        article.append(bibliography);
        let extra;
        if (item.mode === 'inline-reference') p.append(reference());
        else if (item.mode === 'reference-block') {
          extra = document.createElement('div'); extra.append(reference()); fixture.append(extra); selectionEnd = extra;
        } else if (['short-body', 'short-number', 'figure-link', 'entity-link', 'external-range-link', 'local-range-link'].includes(item.mode)) {
          extra = document.createElement('div');
          if (item.mode === 'short-body') extra.textContent = '不变';
          if (item.mode === 'short-number') extra.textContent = '16';
          if (item.mode === 'figure-link') extra.innerHTML = '<a href="#edge-figure-16">16</a>';
          if (item.mode === 'entity-link') extra.innerHTML = '<a href="https://example.invalid/CFH">CFH</a>';
          if (item.mode === 'external-range-link') extra.innerHTML = '<a href="https://example.invalid/reference-ranges">16</a>';
          if (item.mode === 'local-range-link') {
            extra.innerHTML = '<a href="#reference-ranges">16</a>';
            const target = document.createElement('section'); target.id = 'reference-ranges';
            target.textContent = 'Numeric reference ranges for the laboratory measurements.';
            article.append(target);
          }
          fixture.append(extra); selectionEnd = extra;
        } else if (item.mode.startsWith('inline-button-')) {
          if (item.mode === 'inline-button-prose') selectionStart = selectionEnd = span;
        } else if (item.mode === 'fragment-diagnostic') {
          const left = span.cloneNode(false), right = span.cloneNode(false);
          left.textContent = zh.slice(0, 9); right.textContent = zh.slice(9);
          p.replaceChildren(left, document.createTextNode('额外敏感诊断文字'), right);
        } else {
          extra = document.createElement('div');
          const controlEnglish = 'The following control configures the publication reading interface.';
          const controlChinese = '下面的控件配置论文阅读界面。';
          if (item.mode === 'button-only') {
            const button = document.createElement('button'); button.textContent = controlEnglish; extra.append(button);
          } else {
            extra.contentEditable = 'true'; extra.textContent = controlEnglish;
          }
          fixture.append(extra); await sleep(180);
          const controlSpan = extra.querySelector('[data-pb-sentence]');
          if (controlSpan) controlSpan.textContent = controlChinese;
          else if (item.mode === 'button-only') extra.querySelector('button').textContent = controlChinese;
          else extra.textContent = controlChinese;
          selectionStart = selectionEnd = extra;
        }
        const range = document.createRange(); range.setStartBefore(selectionStart); range.setEndAfter(selectionEnd);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        const selected = getSelection().toString();
        selectionStart.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(150);
        if (document.querySelector('.pb-panel').dataset.open !== 'true') {
          document.querySelector('.pb-selection-button').click(); await sleep(150);
        }
        await sleep(80);
        document.querySelector('.pb-boundary-details').click(); await sleep(40);
        const detailedReport = report || null;
        let ordinaryReport = null;
        if (item.mode === 'fragment-diagnostic') {
          document.querySelector('.pb-diagnostics').click(); await sleep(40);
          ordinaryReport = report || null;
        }
        return { selected, actualMapped: !document.querySelector('.pb-sync').disabled,
          source: document.querySelector('.pb-source').textContent,
          status: document.querySelector('.pb-status').textContent,
          proposalVisible: !document.querySelector('.pb-scope-proposal').hidden,
          diagnostic: detailedReport, ordinaryDiagnostic: ordinaryReport, expectedEnglish: en,
          selectedExtra: extra?.textContent || null };
      }, item);
      evidence.push({ name: item.name, mode: item.mode, expectedMapped: item.mapped, ...result });
      if (result.actualMapped !== item.mapped)
        throw Error(`expected mapped=${item.mapped}, actual mapped=${result.actualMapped}; status=${result.status}`);
      if (item.mapped && result.source !== result.expectedEnglish)
        throw Error('verified citation exclusion changed the underlying source quotation');
      if (!item.mapped && result.proposalVisible)
        throw Error('unknown or interactive text must not be repaired with a whole-source proposal');
      if (['short-body', 'short-number', 'figure-link', 'entity-link', 'external-range-link', 'local-range-link'].includes(item.mode)) {
        const unmatched = result.diagnostic?.blocks?.find(block =>
          block.selectedCharacters === result.selectedExtra.length && !block.hasEnglishParagraph);
        if (!unmatched) throw Error('diagnostic did not identify the separate unmatched block');
        if (unmatched.reason !== 'no-sentence-anchors') throw Error('unexpected unmatched-block diagnostic');
      }
      if (item.mode === 'inline-button-prose' && result.selected.includes('Copy'))
        throw Error('prose-only control fixture accidentally selected the button');
      if (item.mode === 'inline-button-crossed') {
        if (!result.selected.includes('Copy')) throw Error('crossed-control fixture did not select the button');
        if (!result.diagnostic?.selectionIssue) throw Error('crossed-control selection lacks an explicit control diagnostic');
      }
      if (item.mode === 'fragment-diagnostic') {
        const detailedFailure = result.diagnostic?.blocks?.find(block =>
          block.fragmentGroupFailure?.reason === 'unmarked-content')?.fragmentGroupFailure;
        if (!detailedFailure || !detailedFailure.rangeText?.includes('额外敏感诊断文字'))
          throw Error('privacy fixture did not exercise the grouped-fragment text failure');
        if (!result.ordinaryDiagnostic) throw Error('ordinary diagnostic was not produced');
        const ordinary = JSON.stringify(result.ordinaryDiagnostic);
        if (/coveredText|rangeText|selectedText|额外敏感诊断文字/.test(ordinary))
          throw Error('ordinary diagnostic contains grouped or selected text');
        const ordinaryFailure = result.ordinaryDiagnostic.blocks?.find(block =>
          block.fragmentGroupFailure)?.fragmentGroupFailure;
        if (ordinaryFailure?.reason !== 'unmarked-content') throw Error('redaction also removed the useful failure reason');
      }
      passed.push(item.name);
    } catch (error) { failures.push({ name: item.name, error: String(error) }); }
  }
  page.off('pageerror', onError);
  return { passed, failures, evidence, pageErrors, realZoteroUsed: false,
    scope: 'Constructed DOM edge-block audit; the two unknown characters from the user report remain unknown.' };
}
