async page => {
  // 实际滚动到每个英文来源单位，触发 Chrome 内置谷歌翻译的延迟翻译。
  const units=await page.evaluate(()=>__auditSource.flatMap(p=>p.sentences.map(s=>({...s,paragraph:p.id}))));
  page._untranslated=[];
  for(const unit of units) {
    const span=page.locator(`[data-audit-block="${unit.paragraph}"] [data-pb-sentence="${unit.key}"]`).filter({visible:true}).first();
    if(!await span.count()){page._untranslated.push({key:unit.key,reason:'missing'});continue;}
    await span.scrollIntoViewIfNeeded();
    if((unit.text.match(/[a-zA-Z]{3,}/g)||[]).length<3)continue;
    try{await page.waitForFunction(key=>[...document.querySelectorAll(`[data-pb-sentence="${key}"]`)].some(n=>/[\u3400-\u9fff]/.test(n.textContent)),unit.key,{timeout:9000});}
    catch{page._untranslated.push({key:unit.key,paragraph:unit.paragraph,text:unit.text.slice(0,90)});}
  }
  return {units:units.length,untranslated:page._untranslated};
}
