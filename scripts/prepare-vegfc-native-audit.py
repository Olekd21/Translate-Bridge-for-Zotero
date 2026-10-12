# 输入：下载的 PMC 原始 HTML；输出：只在隔离浏览器使用的测试页面。
from pathlib import Path
from bs4 import BeautifulSoup
ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache/vegfc155'
soup = BeautifulSoup((CACHE/'pmc-source.html').read_text(encoding='utf-8'), 'html.parser')
blocks = soup.select('#abstract1 > p, section[id^="ctm2374-sec-"] > p, figure figcaption p, #ctm2374-abs-0001 > p')
blocks = [p for p in blocks if len(p.get_text(strip=True)) > 30]
for i, p in enumerate(blocks): p['data-audit-block'] = str(i)
style = soup.new_tag('style'); style.string = (ROOT/'packages/browser-extension/content.css').read_text(encoding='utf-8'); soup.head.append(style)
shim = soup.new_tag('script'); shim.string = '''window.chrome={storage:{local:{get:async x=>x,set:async()=>{}}},runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:false,error:'Isolated test: Zotero disabled'})}};'''; soup.body.append(shim)
source = (ROOT/'packages/browser-extension/content.js').read_text(encoding='utf-8')
hook = 'window.__pbAudit={buildAnchor,mapTranslatedSelection,sourceParagraphByKey,sentenceByKey,sourceParagraphSnapshot,normalizedReadableText,sliceTextRange,sentenceGroups,selectionWithoutReferences,englishSentenceSegments};'
pos = source.rfind('})();')
assert pos >= 0
script = soup.new_tag('script'); script.string = source[:pos] + hook + source[pos:]; soup.body.append(script)
(CACHE/'pmc-instrumented.html').write_text(str(soup),encoding='utf-8')
print({'paragraphs':len(blocks),'captions':sum(bool(p.find_parent('figcaption')) for p in blocks)})
