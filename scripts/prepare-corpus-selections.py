"""Short selections and publisher HTML cases with independent PDF ground truth."""
import hashlib
import json
import re
import unicodedata
from pathlib import Path
import fitz
import requests
from bs4 import BeautifulSoup

BASE=Path(__file__).resolve().parents[1]/'.cache/corpus-audit'
manifest=json.loads((BASE/'manifest.json').read_text(encoding='utf-8'))
def compact(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).lower() if c.isalnum())

sources={
 'psychology':('https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0114255','div.article-text p'),
 'climate':('https://gmd.copernicus.org/articles/13/5175/2020/','div.sec p'),
 'bert':('https://aclanthology.org/N19-1423/','div.acl-abstract'),
 'dropout':('https://jmlr.org/papers/v15/srivastava14a.html','p.abstract'),
}
source_report=[]
for paper in manifest:
    blocks=json.loads((BASE/(paper['id']+'-cases.json')).read_text(encoding='utf-8'))
    doc=fitz.open(paper['path'])
    cases=[]
    for pi in range(len(doc)):
        onpage=[c for c in blocks if c['expectedPageIndex']==pi]
        if not onpage: continue
        case=onpage[pi%len(onpage)]
        words=case['selector']['exact'].split()
        for label,width,start in [('start',5,0),('middle',12,max(0,len(words)//2-6)),('end',20,max(0,len(words)-20))]:
            selected=words[start:start+width]
            if len(selected)<5:continue
            cases.append({**case,'id':case['id']+'-'+label,'region':'short-'+label,
                'selector':{'type':'TextQuoteSelector','exact':' '.join(selected),'prefix':' '.join(words[:start])[-96:], 'suffix':' '.join(words[start+width:])[:96]}})
    (BASE/(paper['id']+'-short.json')).write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
    htmlcases=[]
    if paper['id'] in sources:
        url,css=sources[paper['id']]
        try:
            snapshot=BASE/(paper['id']+'.html')
            if not snapshot.exists():
                r=requests.get(url,timeout=40);r.raise_for_status()
                snapshot.write_text(r.text,encoding='utf-8')
            html=snapshot.read_text(encoding='utf-8')
            soup=BeautifulSoup(html,'html.parser')
            paras=[re.sub(r'^Abstract\s*','',n.get_text(' ',strip=True)) for n in soup.select(css)]
            paras=[p for p in paras if len(p.split())>=20]
            if not paras: raise ValueError('No publisher paragraphs for selector '+css)
            pdfblocks=[(pi,b) for pi,p in enumerate(doc) for b in p.get_text('blocks') if b[6]==0]
            # Use multiple positions spread across the whole publisher HTML.
            for index in sorted(set(round(i*(len(paras)-1)/11) for i in range(min(12,len(paras))))):
                text=' '.join(paras[index].split()[:30])
                needle=compact(text)
                expected=[(pi,b) for pi,b in pdfblocks if needle in compact(b[4])]
                # Ground truth requires one independently verified PDF block.
                # Unmappable HTML is recorded separately, never counted as pass.
                if len(expected)!=1:
                    source_report.append({'paper':paper['id'],'paragraph':index,'unmapped':True});continue
                pi,b=expected[0]
                htmlcases.append(dict(id=f'{paper["id"]}-html-{index}',source=url,region='publisher-html',expectedPageIndex=pi,
                    expectedBox=list(b[:4]),expectedPdfBox=list(fitz.Rect(b[:4])*~doc[pi].transformation_matrix),selector=dict(type='TextQuoteSelector',exact=text)))
            source_report.append({'paper':paper['id'],'url':url,'sha256':hashlib.sha256(html.encode()).hexdigest(),'paragraphs':len(paras),'verifiedCases':len(htmlcases)})
        except Exception as e: source_report.append({'paper':paper['id'],'url':url,'error':str(e)})
    (BASE/(paper['id']+'-html.json')).write_text(json.dumps(htmlcases,ensure_ascii=False,indent=2),encoding='utf-8')
    print(paper['id'],len(cases),'short',len(htmlcases),'HTML',flush=True)
(BASE/'html-sources.json').write_text(json.dumps(source_report,ensure_ascii=False,indent=2),encoding='utf-8')
