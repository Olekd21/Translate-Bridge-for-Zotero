import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const bundled=await build({entryPoints:['packages/zotero-addon/src/modules/pdfGeometry.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {locateQuoteGeometry:locate}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const word=(text,x=40,y=100)=>[x,y,x+text.length*3,y+10,10,1,0,0,0,0,0,0,0,text];
const page=rows=>[600,800,[[[[0,0,0,0,rows.map((r,i)=>[[word(r,40,80+i*20)]])]]]]];
const selector=exact=>({type:'TextQuoteSelector',exact});

test('short sentence survives line-end hyphenation and ligatures',()=>{
 const q='Selective stimulation of lymphangiogenesis improves cardiac function';
 const r=locate({pages:[page(['Selective stimulation of lymphangio-','genesis improves cardiac function'])]},selector(q));
 assert.equal(r.status,'unique'); assert.equal(r.rects.length,2);
});
test('numeric scientific differences must not produce writable geometry',()=>{
 const q='The treatment reduced systolic blood pressure by 15 percent after 12 weeks compared with baseline measurements';
 const r=locate({pages:[page([q.replace('15','50')])]},selector(q));
 assert.equal(r.status,'not-found'); assert.equal(r.rects,undefined);
});
test('different gene identifiers must not be treated as the same quote',()=>{
 const q='Expression of PROX1 regulates endothelial cell identity and promotes formation of lymphatic vessels during embryonic development';
 assert.equal(locate({pages:[page([q.replace('PROX1','PROX2')])]},selector(q)).status,'not-found');
});
test('decimal points and negative signs cannot disappear in normalization',()=>{
 for (const [a,b] of [['1.5','15'],['-15','15'],['0.05','0.5']]) {
   const q=`The estimated treatment effect was ${a} units after adjustment for baseline covariates in the final study population`;
   assert.equal(locate({pages:[page([q.replace(a,b)])]},selector(q)).status,'not-found');
 }
});
test('opposite mathematical comparisons cannot be normalized to the same claim',()=>{
 for(const [a,b] of [['<','>'],['=','≠'],['≤','≥']]) {
   const q=`The analysis found that p ${a} 0.05 after adjustment for multiple comparisons in all independent study cohorts`;
   assert.equal(locate({pages:[page([q.replace(a,b)])]},selector(q)).status,'not-found');
 }
});
test('matching sentence ends cannot authorize an unrelated middle',()=>{
 const q='This study provides evidence that the treatment improves survival and reduces disease severity in patients with chronic heart failure';
 const other='This study provides evidence that the treatment increases mortality and causes severe injury in patients with chronic heart failure';
 assert.equal(locate({pages:[page([other])]},selector(q)).status,'not-found');
});
test('only a genuinely matching prefix and suffix disambiguates repeated words',()=>{
 const data={pages:[page(['Alpha group showed significant improvement after treatment.']),page(['Beta group showed significant improvement after treatment.'])]};
 const q=selector('group showed significant improvement');
 assert.equal(locate(data,q).status,'ambiguous');
 const match=locate(data,{...q,prefix:'Beta ',suffix:' after treatment.'});
 assert.equal(match.status,'unique'); assert.equal(match.pageIndex,1);
});
test('image-only or malformed geometry never creates rectangles',()=>{
 for(const data of [{pages:[]},{pages:[[600,800,[]]]},{pages:[null]}]) {
   const r=locate(data,selector('No text layer exists in this scanned document'));
   assert.equal(r.status,'not-found'); assert.equal(r.rects,undefined);
 }
});
test('astral Unicode characters retain aligned owner indices',()=>{
 const q='The mathematical symbol 𝛼 represents the learning rate parameter used during all optimization experiments';
 assert.equal(locate({pages:[page([q.replace('learning rate','learningrate')])]},selector(q)).status,'unique');
});
test('three interleaved columns are read in column order',()=>{
 const chunks=['Left column starts with a complete sentence','Middle column continues the scientific argument','Right column contains the final observation','and provides the necessary context for interpretation','with additional evidence from independent experiments','and explains the limitations of this study'];
 const rows=chunks.map((s,i)=>[[word(s,40+(i%3)*200,100+Math.floor(i/3)*20)]]);
 const data={pages:[[600,800,[[[[0,0,0,0,rows]]]]]]};
 const q=[0,3,1,4,2,5].map(i=>chunks[i]).join(' ');
 assert.equal(locate(data,selector(q)).status,'unique');
});
test('bracketed numeric citation ranges may differ without deleting scientific values',()=>{
 const q='The observed treatment effect of 15 percent remained stable [11, 12, 13, 14] across independent cohorts followed for 12 weeks';
 assert.equal(locate({pages:[page([q.replace('[11, 12, 13, 14]','[11–14]')])]},selector(q)).status,'unique');
});
test('a shared PDF text line cannot paint across the empty inter-column gutter',()=>{
 const data={pages:[[600,800,[[[[0,0,0,0,[[[word('Left selected text',40),word('right selected text',350)]]]]]]]]]};
 const r=locate(data,selector('Left selected text right selected text'));
 assert.equal(r.status,'unique');assert.equal(r.rects.length,2);
 assert.ok(r.rects.every(rect=>rect[2]-rect[0]<200));
});
