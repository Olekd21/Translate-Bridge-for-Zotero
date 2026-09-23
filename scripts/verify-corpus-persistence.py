"""Read-only verification after stopping the isolated Zotero instances."""
import json
import sqlite3
from pathlib import Path
import fitz

BASE=Path(__file__).resolve().parents[1]/'.cache/corpus-audit'
papers=json.loads((BASE/'manifest.json').read_text(encoding='utf-8'))
cases={c['id']:c for p in papers for c in json.loads((BASE/(p['id']+'-cases.json')).read_text(encoding='utf-8'))}
summary=[]
for version in ('9','10'):
    db=BASE/f'zotero{version}/data/zotero.sqlite'
    connection=sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True)
    responses=json.loads((BASE/f'http-final-{version}.json').read_text(encoding='utf-8'))
    writes={r['body']['annotationKey']:r for r in responses if r['endpoint']=='annotations' and r['body'].get('nativePdfHighlightCreated')}
    assert len(writes)==24
    for key,r in writes.items():
        rows=connection.execute('SELECT a.text,a.comment,a.position FROM itemAnnotations a JOIN items i ON a.itemID=i.itemID WHERE i.key=?',(key,)).fetchall()
        assert len(rows)==1
        text,comment,position=rows[0]
        position=json.loads(position)
        assert text==cases[r['id']]['selector']['exact']
        assert '跨领域稳定性测试译文' in comment
        assert ('原批注更新测试' if 'annotations' == r['endpoint'] and r['id'] in {
            row['id'] for row in responses if row['endpoint']=='open-selection'
        } else '独立测试文库中的批注') in comment
        assert position['pageIndex']==r['body']['match']['pageIndex']
        assert position['rects']==r['body']['match']['rects']
    assert connection.execute('SELECT count(*) FROM itemAnnotations').fetchone()[0]==24, 'Unexpected duplicate or negative-case write'
    summary.append(dict(zotero=version,persisted=24,unique=24,extraWrites=0,verified=True))
    connection.close()

# Render six independent PDFs around the selected text, with actual saved
# highlight positions (yellow) and independent source block bounds (green).
responses=json.loads((BASE/'http-final-10.json').read_text(encoding='utf-8'))
for pid in ('osa','nature','bert','dropout','climate','geometry-review'):
    paper=next(p for p in papers if p['id']==pid)
    candidates=[r for r in responses if r['endpoint']=='annotations' and r['id'].startswith(pid+'-') and r['body'].get('nativePdfHighlightCreated')]
    r=candidates[len(candidates)//2]
    case=cases[r['id']]
    doc=fitz.open(paper['path']);page=doc[case['expectedPageIndex']]
    rects=[fitz.Rect(box)*page.transformation_matrix for box in r['body']['match']['rects']]
    annot=page.add_highlight_annot(rects);annot.update()
    box=fitz.Rect(case['expectedBox']);page.draw_rect(box,color=(0,0.6,0),width=0.5)
    clip=(box+(-18,-18,18,18)) & page.rect
    page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=clip).save(BASE/f'visual-{pid}.png')
(BASE/'persistence.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
