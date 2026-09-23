"""Download public test PDFs and produce independent PyMuPDF location cases.

Only writes under .cache/corpus-audit; never opens the user's Zotero library.
Run with Python containing requests and PyMuPDF. Full text stays in .cache.
"""
import concurrent.futures
import hashlib
import json
import re
import shutil
from pathlib import Path

import fitz
import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.cache/corpus-audit'
BASE.mkdir(parents=True, exist_ok=True)
PAPERS = [
    dict(id='osa', domain='clinical medicine', kind='observational study', doi='10.1186/s12931-024-02846-7', local='.cache/osa-repro.pdf'),
    dict(id='nature', domain='developmental biology', kind='experimental article and extended data', doi='10.1038/s41586-020-2998-x', local='.cache/samples/s41586-020-2998-x.pdf'),
    dict(id='dropout', domain='machine learning', kind='methods paper', url='https://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf'),
    dict(id='bert', domain='computational linguistics', kind='conference paper', doi='10.18653/v1/N19-1423', url='https://aclanthology.org/N19-1423.pdf'),
    dict(id='ligo', domain='physics', kind='research letter', doi='10.1103/PhysRevLett.116.061102', url='https://arxiv.org/pdf/1602.03837'),
    dict(id='psychology', domain='psychology / statistics', kind='meta research', doi='10.1371/journal.pone.0114255', url='https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0114255&type=printable'),
    dict(id='climate', domain='earth science', kind='model evaluation', doi='10.5194/gmd-13-5175-2020', url='https://gmd.copernicus.org/articles/13/5175/2020/gmd-13-5175-2020.pdf'),
    dict(id='geometry-review', domain='mathematics / machine learning', kind='long review', url='https://arxiv.org/pdf/2104.13478'),
]

def prepare(paper):
    paper = dict(paper)
    target = BASE / (paper['id'] + '.pdf')
    try:
        if not target.exists():
            if paper.get('local'):
                shutil.copyfile(ROOT / paper['local'], target)
            else:
                response = requests.get(paper['url'], timeout=60)
                response.raise_for_status()
                if not response.content.startswith(b'%PDF'): raise ValueError('Not a PDF')
                target.write_bytes(response.content)
        doc = fitz.open(target)
        paper.update(path=str(target), pages=len(doc), sha256=hashlib.sha256(target.read_bytes()).hexdigest())
        cases = []
        # Independently extracted natural text blocks: early/middle/late on EVERY
        # page, plus captions, tables, headings and references. No native matcher
        # output is used to choose expected pages or rectangles.
        for page_index, page in enumerate(doc):
            blocks = [b for b in page.get_text('blocks') if b[6] == 0 and len(b[4].split()) >= 12]
            chosen = set([0, len(blocks)//2, len(blocks)-1]) if blocks else set()
            for i, b in enumerate(blocks):
                if re.match(r'\s*(Fig(?:ure)?\.?\s*\d|Table\s*\d|References|Appendix|Abstract)', b[4], re.I): chosen.add(i)
            for bi in sorted(chosen):
                b = blocks[bi]
                raw = b[4].strip()
                # Keep natural wrapping for dehyphenation, capped to a selection
                # a reader could reasonably make (rather than entire pages).
                cleaned = re.sub(r'(?<=[A-Za-z])-\s*\n\s*(?=[a-z])', '', raw)
                text = ' '.join(cleaned.split()[:60])
                if len(text) < 40: continue
                kind = 'caption' if re.match(r'(Fig(?:ure)?\.?\s*\d|Table\s*\d)', text, re.I) else 'block'
                pdf_box = fitz.Rect(b[:4]) * ~page.transformation_matrix
                cases.append(dict(id=f'{paper["id"]}-p{page_index+1}-b{bi}', source='independent-pdf-text', region=kind,
                    expectedPageIndex=page_index, expectedBox=list(b[:4]), expectedPdfBox=list(pdf_box), selector=dict(type='TextQuoteSelector', exact=text)))
        (BASE / (paper['id'] + '-cases.json')).write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding='utf-8')
        paper['cases'] = len(cases)
        print(paper['id'], len(doc), 'pages', len(cases), 'cases', flush=True)
    except Exception as e:
        paper['error'] = str(e)
        print(paper['id'], 'ERROR', str(e), flush=True)
    return paper

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(prepare, PAPERS))
    (BASE / 'manifest.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
