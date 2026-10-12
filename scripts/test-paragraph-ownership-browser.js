// Structural regression: synthetic English, user-supplied Chinese excerpt.
// Exercises the normal selection/diagnostic UI; no live Zotero access.
export default async page => {
  await page.route('**/*', route => route.continue());
  await page.goto('http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html');
  return page.evaluate(async () => {
    const wait = (ms=140) => new Promise(resolve => setTimeout(resolve, ms));
    const english = [
      'We next assessed direct cardiac delivery in adult mice after myocardial infarction.',
      'Bioengineered collagen patches served as a scaffold for recombinant protein delivery.',
      'Protein-containing patches and control patches were sutured onto injured hearts immediately after infarction.',
      'Cardiac function was assessed weekly and the treatment group showed improved ejection fraction after three weeks.',
      'Fibrotic scar area was reduced in treated hearts six weeks after injury.',
      'Additional observations examined the surrounding cardiac tissue.',
      'Independent measurements supported the reported functional changes.',
      'Control animals were assessed with the same experimental procedure.',
      'These observations were evaluated in the original experimental setting.',
    ];
    const chinese = [
      '接下来，我们评估了将RELN直接递送至心脏是否能改善成年野生型小鼠心肌梗死后的心脏修复。',
      '我们利用成熟的生物工程胶原蛋白贴片28,29作为支架，将重组RELN蛋白递送至心脏。',
      '在急性心肌梗死后立即将含有RELN的贴片和对照贴片缝合到约两个月大的受损心脏上（图4e，f）。',
      '每周评估心脏功能（心肌梗死后1-6周），心肌梗死后21天，RELN贴片组小鼠的射血分数显著提高（图4g）。',
      '与心脏功能的改善相一致，心肌梗死后42天，RELN贴片组小鼠梗死区域的纤维化瘢痕面积显著缩小（图4h）。',
      '附加观察检查了周围的心脏组织。',
      '独立测量支持报告的功能变化。',
      '对照动物采用相同的实验程序进行评估。',
      '这些观察结果在原始实验条件下进行了评估。',
    ];
    const paper = document.getElementById('paper');
    const makeSource = async (tag='div') => {
      const source = document.createElement(tag);
      source.textContent = english.join(' '); paper.append(source); await wait();
      const markers = [...source.querySelectorAll('[data-pb-sentence]')];
      if(markers.length!==english.length)throw Error(`expected 9 markers, got ${markers.length}`);
      return {source,markers};
    };
    const project = (markers,tag='p',limit=markers.length) => {
      const target = document.createElement(tag);
      markers.slice(0,limit).forEach((marker,index)=>{
        const copy=marker.cloneNode(false); copy.textContent=chinese[index]; target.append(copy);
        if(index<4)target.append(marker.cloneNode(false));
      });
      return target;
    };
    let diagnostic;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{diagnostic=JSON.parse(value);}}});
    const inspect = async (target,partial=false) => {
      const range=document.createRange();
      if(partial){
        const first=target.querySelectorAll('[data-pb-sentence]')[2];
        const last=target.querySelectorAll('[data-pb-sentence]')[8];
        range.setStartBefore(first);range.setEndAfter(last);
      }else range.selectNodeContents(target);
      getSelection().removeAllRanges();getSelection().addRange(range);
      target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));await wait();
      if(document.querySelector('.pb-panel').dataset.open!=='true')document.querySelector('.pb-selection-button').click();
      await wait();
      const source=document.querySelector('.pb-source').textContent;
      const ready=!document.querySelector('.pb-open-selection').disabled;
      document.querySelector('.pb-diagnostics').click();await wait(20);
      if(!diagnostic)throw Error('diagnostic UI did not produce a result');
      return {ready,source,block:diagnostic.blocks[0]};
    };
    const results=[];
    // Original DIV remains connected after its text is placed in a new P.
    {
      const {source,markers}=await makeSource();
      const target=project(markers);source.replaceChildren(target);await wait();
      results.push({name:'connected-owner-new-paragraph-tag',...(await inspect(target,true)),expected:english.slice(1,5).join(' ')});
      source.remove();await wait();
    }
    // A same-tag clone is already supported; retained as a control.
    {
      const {source,markers}=await makeSource('p');
      const target=project(markers);source.replaceWith(target);await wait();
      results.push({name:'same-tag-control',...(await inspect(target,true)),expected:english.slice(1,5).join(' ')});
      target.remove();await wait();
    }
    // Full source identity can also survive replacement of the original DIV.
    {
      const {source,markers}=await makeSource();
      const target=project(markers);source.replaceWith(target);await wait();
      results.push({name:'replaced-owner-new-paragraph-tag',...(await inspect(target)),expected:english.join(' ')});
      target.remove();await wait();
    }
    // An incomplete set, a mixed source and a heading are still not paragraphs
    // authorized to inherit the full snapshot from copied attributes/markers.
    for(const mode of ['missing-marker','mixed-sources','changed-semantic-role']) {
      const {source,markers}=await makeSource();
      const target=project(markers,mode==='changed-semantic-role'?'h2':'p',mode==='missing-marker'?8:9);
      target.dataset.pbParagraph=source.dataset.pbParagraph;
      let other;
      if(mode==='mixed-sources') {
        other=await makeSource('p');
        target.append(project(other.markers).firstChild);
      }
      paper.append(target);await wait();
      results.push({name:mode,...(await inspect(target)),expected:null});
      source.remove();target.remove();other?.source.remove();await wait();
    }
    for(const result of results) {
      if(result.expected ? (!result.ready || result.source!==result.expected) : result.ready)
        throw Error(`ownership regression: ${result.name}`);
      if(!result.expected && !result.block.sourceAssociation)throw Error(`missing source evidence: ${result.name}`);
    }
    return {results};
  });
};
