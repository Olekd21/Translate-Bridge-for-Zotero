async (page) => {
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  return await page.evaluate(async () => {
    const source = await (await fetch('/packages/browser-extension/content.js', {cache:'no-store'})).text();
    const extract = (name, next) => source.slice(source.indexOf('  function ' + name + '('), source.indexOf('  function ' + next + '('));
    const normalize = new Function(extract('normalizedReadableText','looksPrimarilyEnglish') +
      extract('compactChinese','bigramSimilarity') + extract('isBibliographyReferenceLink','sliceTextRange') +
      'return selectionWithoutReferences;')();
    const host = document.createElement('div'); document.body.append(host);
    host.innerHTML = '<span>纤维化</span><sup><a href="#ref-CR20"><font><span>20</span></font></a>、<a href="#ref-CR21"><span>21</span></a></sup><span>、炎症及血管生成。</span><span>IL-33在8周改变。</span>';
    const tests = [];
    const check = (name, actual, expected) => { tests.push({name, actual, expected}); if(actual!==expected) throw Error(JSON.stringify(tests)); };
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('a span'));
    check('citation descendants preserve reference ancestry', normalize(range), '');
    range.selectNodeContents(host.querySelector('sup'));
    check('multi-link citation punctuation is consistently omitted', normalize(range), '');
    range.selectNodeContents(host);
    check('scientific numbers and body text are retained', normalize(range), '纤维化炎症及血管生成il-33在8周改变');
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let node, fragments = '';
    while ((node=walker.nextNode())) {range.selectNodeContents(node);fragments+=normalize(range);}
    range.selectNodeContents(host);
    check('group coverage equals concatenated text-node coverage', fragments, normalize(range));
    const last = host.lastChild.firstChild;
    range.setStart(last,0);range.setEnd(last,5);
    check('partial text boundary retains only selected characters',normalize(range),'il-33');
    host.innerHTML='<sup><a href="#ref-CR38">38</a>，<a href="#fig4">4</a></sup>';
    range.selectNodeContents(host);
    check('a real reference never erases a neighbouring figure number', normalize(range), '4');
    host.innerHTML='<sup><a href="#ref-CR38">38</a> 5</sup>';
    range.selectNodeContents(host);
    check('a real reference never erases an unlinked numerical value', normalize(range), '5');
    host.remove(); return {passed:tests.length,tests};
  });
}
