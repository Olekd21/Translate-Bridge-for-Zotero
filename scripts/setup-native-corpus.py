"""Prepare a NEW isolated Zotero profile for native PDF corpus extraction.

Test-only startup instrumentation is packaged into a COPY of the XPI. It imports
public corpus PDFs into this separate library and exports native recognizer data.
Never installs anything into the user's profile. Launch manually with -no-remote.
"""
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / '.cache/corpus-audit'
version = sys.argv[1]
assert version in ('9', '10')
dest = BASE / ('zotero' + version)
profile = dest / 'profile'
data = dest / 'data'
profile.mkdir(parents=True, exist_ok=True)
(profile / 'extensions').mkdir(exist_ok=True)
data.mkdir(exist_ok=True)
prefs = {
    'extensions.zotero.useDataDir': True,
    'extensions.zotero.dataDir': str(data),
    'extensions.zotero.httpServer.port': 23200 + int(version),
    'extensions.zotero.firstRun2': False,
    'extensions.zotero.firstRunGuidance': False,
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'app.update.auto': False,
    'extensions.zotero.paperbridge.pairingToken': 'isolated-corpus-test',
}
(profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()), encoding='utf-8')
script = r'''
void (async () => {
 const report = {version:Zotero.version,papers:[]};
 const save = () => Zotero.File.putContentsAsync(REPORT, JSON.stringify(report,null,2));
 try {
   report.stage='startup'; await save();
   const IOUtils=Zotero.getMainWindow().IOUtils;
   if (Zotero.DataDirectory.dir !== DATA) throw new Error('Wrong isolated data directory');
   report.stage='library'; await save();
   await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
   report.stage='bundle'; await save();
   const scope = {Zotero,setTimeout,clearTimeout,ztoolkit:{getGlobal:()=>IOUtils}};
   Services.scriptloader.loadSubScript(BUNDLE,scope);
   const papers = JSON.parse(await Zotero.File.getContentsAsync(MANIFEST));
   for (const paper of papers.filter(p=>!p.error)) {
     const result={id:paper.id}; report.papers.push(result); await save();
     try {
       const item=new Zotero.Item('journalArticle'); item.setField('title','Corpus audit '+paper.id);
       if(paper.doi) item.setField('DOI',paper.doi); await item.saveTx();
       const attachment=await Zotero.Attachments.importFromFile({file:paper.path,parentItemID:item.id});
       result.itemID=item.id; result.attachmentID=attachment.id;
       const start=Date.now();
       const geometry=await scope.CorpusModules.readFullPdfGeometry(attachment);
       result.ms=Date.now()-start; result.pages=geometry.pages.length;
       await Zotero.File.putContentsAsync(DEST+'\\'+paper.id+'-native.json',JSON.stringify(geometry));
     } catch(e) { result.error=String(e)+'\n'+(e.stack||''); }
     await save();
   }
   report.complete=true;
 } catch(e) {report.error=String(e)+'\n'+(e.stack||'');}
 await save();
})();
'''
for key, value in dict(REPORT=str(dest/'report.json'), DEST=str(dest), DATA=str(data), BUNDLE=(BASE/'native-bundle.js').as_uri(), MANIFEST=str(BASE/'manifest.json')).items():
    script = script.replace(key, json.dumps(value))
addon_version=json.loads((ROOT/'packages/zotero-addon/package.json').read_text(encoding='utf-8'))['version']
xpi = Path(sys.argv[2]) if len(sys.argv)>2 else ROOT/f'dist/translate-bridge-zotero-{addon_version}.xpi'
with ZipFile(xpi) as src, ZipFile(profile/'extensions/paperbridge@local.research.xpi','w',ZIP_DEFLATED) as out:
    for name in src.namelist():
        content=src.read(name)
        if name=='bootstrap.js':
            text=content.decode()
            marker='await Zotero.PaperBridge.hooks.onStartup();'
            assert marker in text
            text=text.replace(marker,marker+'\n Services.scriptloader.loadSubScript(rootURI + "corpus-audit.js", {Zotero, Services, ChromeUtils, setTimeout, clearTimeout});')
            content=text.encode()
        out.writestr(name,content)
    out.writestr('corpus-audit.js',script)
print(profile)
