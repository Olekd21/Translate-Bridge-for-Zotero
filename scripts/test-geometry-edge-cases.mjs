import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const bundled=await build({entryPoints:['packages/zotero-addon/src/modules/pdfGeometry.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {locateQuoteGeometry:locate}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const word=(text,x=40,y=100)=>[x,y,x+text.length*3,y+10,10,1,0,0,0,0,0,0,0,text];
const page=rows=>[600,800,[[[[0,0,0,0,rows.map((r,i)=>[[word(r,40,80+i*20)]])]]]]];
const selector=exact=>({type:'TextQuoteSelector',exact});

test('cross-page paragraph skips sparse figure labels, never intervening prose',()=>{
 const left='Lymphatic capillaries in all organs are composed of a monolayer of oak leaf shaped endothelial cells';
 const right='These cells form a continuous network supporting fluid balance and immune surveillance throughout the heart';
 const labels=['LYVE1','Podocalyxin','FITC dextran','LEC','Macrophage','Capillary','Cadherin 5','Claudin','Flap','Open valve','Closed valve','Lymphangion'];
 const middle=page(labels);
 const result=locate({pages:[page([left]),middle,page([right])]},selector(left+' '+right));
 assert.equal(result.status,'unique');assert.equal(result.pageIndex,0);assert.equal(result.additionalPages[0].pageIndex,2);assert.equal(result.nextPageRects,undefined);
 assert.equal(locate({pages:[page([left]),page([...labels,'This intervening page contains substantive results that must not be skipped.']),page([right])]},selector(left+' '+right)).status,'not-found');
 assert.equal(locate({pages:[page([left]),middle,page([right.replace('supporting','not supporting')])]},selector(left+' '+right)).status,'not-found');
});

test('bounded medical spelling and reference range equivalents retain numeric content',()=>{
 const q='Generalised lymphatic dysfunction was characterised by oedema and reduced contractile activity54,55,56.';
 const data={pages:[page(['Generalized lymphatic dysfunction was characterized by edema and reduced contractile activity54–56.'])]};
 assert.equal(locate(data,selector(q)).status,'unique');
 assert.equal(locate(data,selector(q.replace('54,55,56','54,56'))).status,'not-found');
 assert.equal(locate(data,selector(q.replace('reduced','not reduced'))).status,'not-found');
});

test('medical spelling compatibility does not relax gene names or experimental values',()=>{
 const q='Generalised oedema involved CCL21 positive cells at 12 weeks after treatment.';
 const data={pages:[page(['Generalized edema involved CCL21 positive cells at 12 weeks after treatment.'])]};
 assert.equal(locate(data,selector(q)).status,'unique');
 assert.equal(locate(data,selector(q.replace('CCL21','CCL22'))).status,'not-found');
 assert.equal(locate(data,selector(q.replace('12 weeks','13 weeks'))).status,'not-found');
});

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

test('AHA heart-failure sentence matches PDF discretionary hyphens without losing scientific numbers',()=>{
 const q='After unloading, qRT-PCR analysis of heart failure markers, including natriuretic peptide precursor A (Nppa), natriuretic peptide precursor B (Nppb) was normalized at 8 weeks, whereas myosin heavy chain 7(Myh7), a hypertrophy marker, Platelet endothelial cell adhesion molecule-1 remained unnormalized until 12 weeks (Figure S4A through S4C).';
 const rows=['After unloading, qRT-\u00adPCR analysis of','heart failure markers, including natriuretic peptide pre-','cursor A (Nppa), natriuretic peptide precursor B (Nppb)','was normalized at 8\u2009weeks, whereas myosin heavy','chain 7(Myh7), a hypertrophy marker, Platelet endothe-','lial cell adhesion molecule-\u00ad1 remained unnormalized','until 12\u2009weeks (Figure S4A through S4C).'];
 const r=locate({pages:[page(rows)]},selector(q));
 assert.equal(r.status,'unique');
 assert.equal(r.rects.length,7);
 for(const changed of [q.replace('12 weeks','10 weeks'),q.replace('Myh7','Myh6'),q.replace('molecule-1','molecule-2')]) {
  assert.equal(locate({pages:[page(rows)]},selector(changed)).status,'not-found');
 }
});

test('soft hyphens do not erase actual negative signs',()=>{
 const q='The estimated treatment effect was -15 units after adjustment for baseline covariates in the final study population';
 assert.equal(locate({pages:[page([q.replace('-15','-\u00ad15')])]},selector(q)).status,'unique');
 assert.equal(locate({pages:[page([q.replace('-15','15')])]},selector(q)).status,'not-found');
});

test('Unicode lexical hyphens match ASCII PDF hyphens while preserving numeric signs',()=>{
 const ascii='After unloading, qRT-PCR analysis of heart failure markers, including natriuretic peptide precursor A (Nppa), natriuretic peptide precursor B (Nppb) was normalized at 8 weeks, whereas myosin heavy chain 7(Myh7), a hypertrophy marker, Platelet endothelial cell adhesion molecule-1 remained unnormalized until 12 weeks (Figure S4A through S4C).';
 for(const dash of ['\u2010','\u2011']) {
  const unicode=ascii.replaceAll('-',dash);
  for(const [pdf,quote] of [[ascii,unicode],[unicode,ascii]]) {
   assert.equal(locate({pages:[page([pdf])]},selector(quote)).status,'unique');
   assert.equal(locate({pages:[page([pdf])]},selector(quote.replace('12 weeks','10 weeks'))).status,'not-found');
   assert.equal(locate({pages:[page([pdf])]},selector(quote.replace('Myh7','Myh6'))).status,'not-found');
  }
 }
});

test('bounded word fallback tolerates article differences but not claims or identifiers',()=>{
 const q='Treatment improved the cardiac function in mice during recovery after pressure overload';
 const pdf=q.replace('the cardiac','cardiac');
 assert.equal(locate({pages:[page([pdf])]},selector(q)).status,'unique');
 assert.equal(locate({pages:[page([pdf]),page([pdf])]},selector(q)).status,'ambiguous');
 for(const changed of [pdf.replace('improved','worsened'),pdf.replace('improved','did not improve')]) {
  assert.equal(locate({pages:[page([changed])]},selector(q)).status,'not-found');
 }
 const gene='The precursor A regulates cardiac function in mice during recovery after pressure overload';
 assert.equal(locate({pages:[page([gene.replace('precursor A','precursor')])]},selector(gene)).status,'not-found');
});

test('literal compact matching survives spelling aliases split across PDF words',()=>{
 const variants=[
  ['Cardiac remodelling protects cells during chronic inflammation in the heart.', ['Cardiac remo-', 'delling protects cells during chronic inflammation in the heart.']],
  ['Cardiac signalling protects cells during chronic inflammation in the heart.', ['Cardiac sig-', 'nalling protects cells during chronic inflammation in the heart.']],
  ['Cardiac ageing alters cellular responses during chronic inflammation in the heart.', ['Cardiacageing alters cellular responses during chronic inflammation in the heart.']],
  ['Cardiac oedema alters cellular responses during chronic inflammation in the heart.', ['Cardiacoedema alters cellular responses during chronic inflammation in the heart.']],
 ];
 for(const [text,rows] of variants){
  const data={pages:[page(rows)]};
  assert.equal(locate(data,selector(text)).status,'unique');
  assert.equal(locate(data,selector(text.replace('chronic inflammation','no inflammation'))).status,'not-found');
 }
});

test('comma-only reference normalization retains digit rectangles and one physical match',()=>{
 const texts=['Cardiac','ageing','was','observed','after','treatment', '54', ',', '55', ',', '56', '.'];
 const words=texts.map((t,i)=>word(t,40+i*24,100));
 // The recognizer stores reference digits separately from punctuation.
 const data={pages:[[600,800,[[[[0,0,0,0,[[words]]]]]]]]};
 const result=locate(data,selector('Cardiac ageing was observed after treatment54,55,56.'));
 assert.equal(result.status,'unique');
 for(const i of [6,8,10]) assert.ok(result.rects.some(r=>r[0]<=words[i][0] && r[2]>=words[i][2]));
 assert.equal(locate(data,selector('Cardiac ageing was observed after treatment54,55,57.')).status,'not-found');
});
