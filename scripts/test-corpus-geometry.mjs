// Independent PDF text/block ground truth versus the REAL Zotero recognizer.
// Usage: node scripts/test-corpus-geometry.mjs [9|10] [report-name]
// Requires prepare-corpus-audit.py + setup-native-corpus.py extraction first.
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { build } from '../packages/zotero-addon/node_modules/esbuild/lib/main.js';
const base = '.cache/corpus-audit';
const version = process.argv[2] || '10';
const bundle = await build({entryPoints:['packages/zotero-addon/src/modules/pdfGeometry.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {locateQuoteGeometry} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const papers = JSON.parse(fs.readFileSync(`${base}/manifest.json`,'utf8'));
const report={version,papers:[],results:[]};
for (const paper of papers.filter(p=>!p.error)) {
 const nativePath=`${base}/zotero${version}/${paper.id}-native.json`;
 if(!fs.existsSync(nativePath)) {report.papers.push({id:paper.id,error:'No native data'}); continue;}
 const data=JSON.parse(fs.readFileSync(nativePath));
 if(data.pages.length!==paper.pages) throw new Error(`Incomplete native extraction: ${paper.id}`);
 const cases=JSON.parse(fs.readFileSync(`${base}/${paper.id}-${process.argv[4]||'cases'}.json`));
 const summary={id:paper.id,total:cases.length,correct:0,notFound:0,ambiguous:0,wrong:0,ms:0};
 for(const test of cases) {
   const start=performance.now();
   const match=locateQuoteGeometry(data,test.selector);
   const ms=performance.now()-start;
   // A matching page alone is insufficient: require ALL highlighted rectangles
   // inside the independently extracted block (small font geometry tolerance).
   const [x0,y0,x1,y1]=test.expectedPdfBox;
   const geometryOK=match.rects?.every(([a,b,c,d])=>a>=x0-4&&c<=x1+4&&b>=y0-4&&d<=y1+4);
   const correct=match.status==='unique'&&match.pageIndex===test.expectedPageIndex&&geometryOK;
   const outcome=correct?'correct':match.status==='unique'?'wrong':match.status==='ambiguous'?'ambiguous':'notFound';
   summary[outcome]++; summary.ms+=ms;
   report.results.push({id:test.id,region:test.region,outcome,ms:Math.round(ms*100)/100,expectedPageIndex:test.expectedPageIndex,match});
 }
 summary.ms=Math.round(summary.ms); report.papers.push(summary); console.log(JSON.stringify(summary));
}
fs.writeFileSync(`${base}/${process.argv[3]||'geometry-results-'+version}.json`,JSON.stringify(report,null,2));
if(report.papers.some(p=>p.error||p.wrong)) process.exitCode=1;
