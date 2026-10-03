async page => {
  // Real DOM/UI entry points, with deferred local translation and mocked sync.
  // No browser installation, actual translator or Zotero library is modified.
  await page.route('**/*', route => route.continue());
  await page.unroute('**/packages/browser-extension/content.js');
  if (page.paperbridgeRaceSourceOverride) {
    await page.route('**/packages/browser-extension/content.js', route =>
      route.fulfill({ path: page.paperbridgeRaceSourceOverride, contentType: 'text/javascript; charset=utf-8' }));
  }
  const results = [], pageErrors = [];
  const onError = error => pageErrors.push(String(error));
  page.on('pageerror', onError);
  for (const mode of ['old-success', 'old-failure', 'proposal-rewrite', 'confirmed-rewrite']) {
    await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
    await page.addStyleTag({ url: 'http://127.0.0.1:18841/packages/browser-extension/content.css' });
    try {
      const evidence = await page.evaluate(async mode => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const assert = (condition, message) => { if (!condition) throw Error(message); };
        const compact = value => String(value || '').replace(/\s/g, '');
        const en = 'Among the top upregulated genes, we found complement factor H (CFH), which is a key regulator of the alternative pathway of the complement system, and the cytokine interleukin-33 (IL-33).';
        const c1 = '在显著上调的基因中，我们发现了补体因子H (CFH) 和细胞因子白细胞介素-33 (IL-33)。';
        const c2 = 'CFH是补体系统旁路途径的关键调节因子。';
        const oldEnglish = 'The control instrument remained stable throughout the independent calibration experiment.';
        const oldTranslation = '控制仪器在独立的校准实验中保持稳定。';
        const requests = [], translations = [];
        let release, reject, pending = false;
        chrome.runtime.sendMessage = async message => {
          requests.push(message);
          if (message.type === 'paperbridge:list-annotations') return { ok: true, annotations: [] };
          return { ok: false, error: 'Race regression: mocked Zotero is disconnected' };
        };
        globalThis.Translator = {
          availability: async () => 'available',
          create: async () => ({ translate: text => {
            translations.push(text);
            if (text !== oldEnglish) throw Error('unexpected translator call: ' + text);
            pending = true;
            return new Promise((resolve, fail) => {
              release = () => { pending = false; resolve(oldTranslation); };
              reject = () => { pending = false; fail(Error('old-selection-translation-failed')); };
            });
          } }),
        };
        async function capture(text) {
          const p = document.createElement('p'); p.textContent = text;
          document.getElementById('paper').append(p);
          for (let attempt = 0; attempt < 50 && !p.querySelector('[data-pb-sentence]'); attempt++) await wait(20);
          const marker = p.querySelector('[data-pb-sentence]');
          assert(marker, 'source marker not captured'); return { p, marker };
        }
        async function select(p, node, length) {
          const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, length);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await wait(80);
          if (document.querySelector('.pb-panel').dataset.open !== 'true') {
            document.querySelector('.pb-selection-button').click(); await wait(80);
          }
        }
        function expectProposal() {
          assert(!document.querySelector('.pb-scope-proposal').hidden, 'source-sentence proposal missing');
          assert(document.querySelector('.pb-sync').disabled, 'proposal enabled synchronization before confirmation');
        }
        function expectConfirmed() {
          assert(!document.querySelector('.pb-sync').disabled, 'confirmed scope is not ready');
          assert(compact(document.querySelector('.pb-source').textContent) === compact(en), 'wrong English scope');
          assert(compact(document.querySelector('.pb-translation').textContent) === compact(c1 + c2), 'wrong full Chinese scope');
          assert(!document.querySelector('.pb-scope-notice').hidden, 'confirmed scope notice disappeared');
        }
        const old = await capture(oldEnglish), current = await capture(en);
        const first = document.createTextNode(c1), second = document.createTextNode(c2);
        current.marker.replaceChildren(first, second);
        if (mode.startsWith('old-')) {
          await select(old.p, old.marker.firstChild, oldEnglish.length);
          for (let attempt = 0; attempt < 50 && !pending; attempt++) await wait(20);
          assert(pending && translations[0] === oldEnglish, 'old translation was not actually pending');
        }
        await select(current.p, first, c1.length); expectProposal();
        if (mode === 'proposal-rewrite') {
          second.data = '页面重新翻译后，这里增加了其他实验结果。'; await wait(30);
          document.querySelector('.pb-use-source-sentence').click(); await wait(100);
          assert(document.querySelector('.pb-sync').disabled, 'changed proposal was accepted without a fresh scope review');
          assert(document.querySelector('.pb-open-selection').disabled, 'changed proposal enabled PDF opening');
          return { liveSelection: getSelection().toString(), ready: false, status: document.querySelector('.pb-status').textContent };
        }
        document.querySelector('.pb-use-source-sentence').click(); await wait(100); expectConfirmed();
        if (mode === 'confirmed-rewrite') {
          second.data = '页面重新翻译后，这里增加了其他实验结果。'; await wait(30);
          document.querySelector('.pb-translate').click(); await wait(160);
          assert(document.querySelector('.pb-sync').disabled, 'rematching silently reused a confirmed but stale proposal');
          assert(document.querySelector('.pb-open-selection').disabled, 'stale rematching enabled PDF opening');
          return { liveSelection: getSelection().toString(), ready: false,
            newProposal: !document.querySelector('.pb-scope-proposal').hidden, status: document.querySelector('.pb-status').textContent };
        }
        assert(pending, 'old translation already completed before confirming the new scope');
        const notice = document.querySelector('.pb-scope-notice').textContent;
        if (mode === 'old-success') release(); else reject();
        await wait(160);
        expectConfirmed();
        assert(document.querySelector('.pb-scope-notice').textContent === notice, 'old completion changed scope metadata');
        assert(!document.querySelector('.pb-status').textContent.includes('old-selection-translation-failed'), 'old failure overwrote current status');
        document.querySelector('.pb-sync').click(); await wait(80);
        const sent = requests.filter(message => message.type === 'paperbridge:sync');
        assert(sent.length === 1, 'expected one mocked synchronization request');
        assert(sent[0].annotation.selector.exact === en, 'payload lost the current English scope');
        assert(compact(sent[0].annotation.translation) === compact(c1 + c2), 'payload contains stale translation from the old selection');
        return { oldTranslationWasPending: true, translatorCalls: translations, mockedSyncRequests: sent.length,
          payloadEnglish: sent[0].annotation.selector.exact, payloadChinese: sent[0].annotation.translation };
      }, mode);
      results.push({ mode, passed: true, evidence });
    } catch (error) { results.push({ mode, passed: false, error: String(error) }); }
  }
  page.off('pageerror', onError);
  delete page.paperbridgeRaceSourceOverride;
  return { results, passed: results.filter(result => result.passed).length, failures: results.filter(result => !result.passed), pageErrors };
}
