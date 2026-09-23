"""Exercise final unmodified XPI via HTTP, ONLY against isolated corpus ports."""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE=Path(__file__).resolve().parents[1]/'.cache/corpus-audit'
version=sys.argv[1]
assert version in ('9','10')
port=23200+int(version)
results=[]
previous_path=BASE/f'http-final-{version}.json'
previous=json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else []
previous_keys={r['id']:r['body']['annotationKey'] for r in previous if r['endpoint']=='annotations' and r['body'].get('annotationKey')}
def call(endpoint,payload,token='isolated-corpus-test'):
    start=time.monotonic()
    request=urllib.request.Request(f'http://127.0.0.1:{port}/paperbridge/{endpoint}', data=json.dumps(payload).encode(),
        headers={'Content-Type':'application/json','X-Paper-Bridge-Token':token,'Zotero-Allowed-Request':'1','X-Zotero-Connector-API-Version':'3'})
    try:
        with urllib.request.urlopen(request,timeout=125) as response: status=response.status;body=json.loads(response.read())
    except urllib.error.HTTPError as e: status=e.code;body=json.loads(e.read())
    result=dict(endpoint=endpoint,id=payload.get('id'),status=status,seconds=round(time.monotonic()-start,3),body=body)
    results.append(result)
    (BASE/f'http-final-{version}.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    return result

ping=call('ping',{})
expected_version=json.loads((BASE.parents[1]/'packages/zotero-addon/package.json').read_text(encoding='utf-8'))['version']
assert ping['body']['version']==expected_version,ping
assert ping['body']['zoteroVersion'].startswith(version+'.'),ping
manifest=json.loads((BASE/'manifest.json').read_text(encoding='utf-8'))
matches=json.loads((BASE/f'optimized-{version}.json').read_text(encoding='utf-8'))
correct={r['id'] for r in matches['results'] if r['outcome']=='correct'}
for paper in manifest:
    cases=json.loads((BASE/(paper['id']+'-cases.json')).read_text(encoding='utf-8'))
    cases=[c for c in cases if c['id'] in correct]
    prior_cases=[c for c in cases if c['id'] in previous_keys]
    chosen=prior_cases if len(prior_cases)==3 else [cases[0],cases[len(cases)//2],cases[-1]]
    for index,case in enumerate(chosen):
        payload=dict(schemaVersion=1,id=case['id'],document={'title':'Corpus audit '+paper['id']},selector=case['selector'],translation='跨领域稳定性测试译文',comment='独立测试文库中的批注',color='#ffd400')
        if case['id'] in previous_keys: payload['annotationKey']=previous_keys[case['id']]
        response=call('annotations',payload)
        assert response['body'].get('nativePdfHighlightCreated'),response
        match=response['body']['match']
        assert match['pageIndex']==case['expectedPageIndex'],response
        a,b,c,d=case['expectedPdfBox']
        assert all(x>=a-4 and z<=c+4 and y>=b-4 and w<=d+4 for x,y,z,w in match['rects']),response
        if index==0:
            opened=call('open-selection',payload)
            assert opened['body'].get('ok'),opened
            key=response['body']['annotationKey']
            updated=call('annotations',{**payload,'annotationKey':key,'comment':'原批注更新测试'})
            assert updated['body'].get('annotationKey')==key,updated
    print(version,paper['id'],'3 writes + open + update passed',flush=True)

base=dict(schemaVersion=1,id='negative',document={'title':'Corpus audit osa'},selector={'type':'TextQuoteSelector','exact':'This invented quotation about extraterrestrial pumpkins does not exist in this clinical sleep apnea article'},translation='不应写入',comment='negative',color='#ffd400')
for payload,token in [(base,'isolated-corpus-test'),(base,'wrong-test-token'),({**base,'selector':{'exact':''}},'isolated-corpus-test')]:
    response=call('annotations',payload,token)
    assert not response['body'].get('nativePdfHighlightCreated') and not response['body'].get('ok'),response
print('completed',version,len(results),'HTTP requests',flush=True)
