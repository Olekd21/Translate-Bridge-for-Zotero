async page => {
  await page.route('**/*', route => route.continue());
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  return page.evaluate(async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const passed = [], failures = [];
    for (const [name, original, fragments] of [
      ['thousands separator', 'The experiment measured a total of 2,500 endothelial cells.', ['实验测得内皮细胞共2', ',', '500个。']],
      ['time separator', 'The final measurement was collected at 12:30 during the experiment.', ['实验最后一次测量时间为12', ':', '30。']],
      ['prime notation', "The assay measured the abundance of the 5' terminal sequence.", ['实验测量5', "'", '端序列的丰度。']],
      ['decimal point', 'The measured proliferation rate increased by 2.5% after treatment.', ['处理后测得增殖率增加了2', '.', '5%。']],
    ]) {
      const p = document.createElement('p'); p.textContent = original;
      document.querySelector('#paper').append(p); await sleep(80);
      const span = p.querySelector('[data-pb-sentence]');
      if (!span || p.querySelectorAll('[data-pb-sentence]').length !== 1) throw Error('invalid source capture: ' + name);
      span.replaceWith(...fragments.map(text => { const clone=span.cloneNode(false);clone.textContent=text;return clone; }));
      await sleep(60);
      const range=document.createRange();range.selectNodeContents(p);
      getSelection().removeAllRanges();getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await sleep(60);
      document.querySelector('.pb-selection-button').click();await sleep(100);
      const actual=document.querySelector('.pb-source').textContent;
      if (actual === original && !document.querySelector('.pb-sync').disabled) passed.push(name);
      else failures.push({name,actual,status:document.querySelector('.pb-status').textContent});
    }
    return {passed, failures};
  });
}
