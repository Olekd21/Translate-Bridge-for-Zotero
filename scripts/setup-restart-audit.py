"""Prepare fresh, isolated Zotero profiles; never modify the user's profile."""
import json, os, shutil
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
base = root / '.cache' / ('restart-audit-' + version + os.environ.get('BRIDGE_RESTART_SUFFIX',''))
assert not base.exists(), 'Use a fresh audit directory'
script = r'''
var timer;
function install() {}
function uninstall() {}
function shutdown() {}
async function startup() {
  const {setTimeout} = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  setTimeout(async () => {
  await Promise.all([Zotero.initializationPromise, Zotero.uiReadyPromise]);
  const report={version:Zotero.version,started:Date.now()};
  try {
    if(Zotero.DataDirectory.dir !== DATA) throw new Error('Wrong data directory');
    const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const old=await IOUtils.readJSON(RESULT).catch(()=>({round:0}));
    report.round=old.round+1;
    let addon=await AddonManager.getAddonByID('paperbridge@local.research');
    if(report.round===1) {
      if(addon)throw new Error('Unexpected preinstalled bridge');
      const file=Zotero.File.pathToFile(XPI);
      const pending=await AddonManager.getInstallForFile(file);
      await pending.install();
      addon=await AddonManager.getAddonByID('paperbridge@local.research');
      if(addon.userDisabled)await addon.enable();
    }
    // Later rounds must NOT reinstall/enable the bridge: that would hide loss.
    if(!addon)throw new Error('Bridge disappeared after restart');
    const deadline=Date.now()+20000;
    while(!Zotero.PaperBridge?.data?.initialized&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
    report.addon={version:addon.version,active:addon.isActive,userDisabled:addon.userDisabled,
      temporary:addon.temporarilyInstalled,root:addon.getResourceURI().spec};
    if(!addon.isActive||addon.temporarilyInstalled||!Zotero.PaperBridge?.data?.initialized)throw new Error('Not persistently active');
    const ping=await new Zotero.Server.Endpoints['/paperbridge/ping']().init({method:'POST',headers:{'X-Paper-Bridge-Token':'restart-audit-only'},data:{}});
    report.ping={status:ping[0],body:JSON.parse(ping[2])};
    if(ping[0]!==200)throw new Error('Ping failed');
    if(PDF_PATH && report.round===1) {
      const item=new Zotero.Item('journalArticle');item.setField('title','Isolated AHA Chinese rematch audit');
      item.setField('DOI','10.1161/JAHA.125.047618');await item.saveTx();
      const attachment=await Zotero.Attachments.importFromFile({file:PDF_PATH,parentItemID:item.id});
      report.article={attachmentId:attachment.id,checks:[]};
      for(const [index,anchor] of ANCHORS.entries()) {
        const payload={schemaVersion:1,id:'aha-rematch-'+index,document:{doi:'10.1161/JAHA.125.047618'},selector:{type:'TextQuoteSelector',exact:anchor.exact},translation:anchor.translation,comment:'Isolated regression only',color:'#ffd400'};
        const response=await new Zotero.Server.Endpoints['/paperbridge/annotations']().init({method:'POST',headers:{'X-Paper-Bridge-Token':'restart-audit-only'},data:payload});
        const body=JSON.parse(response[2]);
        report.article.checks.push({name:anchor.name,status:response[0],nativePdfHighlightCreated:body.nativePdfHighlightCreated,match:body.match,error:body.error});
        if(![200,201].includes(response[0])||!body.nativePdfHighlightCreated||body.match.pageIndex!==2)throw new Error('AHA PDF annotation failed: '+JSON.stringify(body));
      }
      report.article.annotationCount=attachment.getAnnotations().length;
      if(report.article.annotationCount!==ANCHORS.length)throw new Error('Annotation count mismatch');
    }else if(old.article) {
      report.article=old.article;
      const attachment=await Zotero.Items.getAsync(old.article.attachmentId);
      if(attachment.getAnnotations().length!==old.article.annotationCount)throw new Error('Annotations did not survive restart');
    }
    report.ok=true;
  }catch(error){report.error=String(error)+'\n'+(error.stack||'');}
  await IOUtils.writeJSON(RESULT,report);
  await IOUtils.writeJSON(RESULT+'.round-'+report.round+'.json',report);
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  }, 500);
}
'''
for v in ('9', '10'):
    folder = base / ('zotero' + v)
    profile = folder / 'profile'
    data = folder / 'data'
    (profile / 'extensions').mkdir(parents=True)
    data.mkdir()
    prefs = {
        'extensions.zotero.useDataDir': True,
        'extensions.zotero.dataDir': str(data),
        'extensions.zotero.httpServer.port': 23420 + int(v),
        'extensions.zotero.firstRun2': False,
        # Isolated helper permission only. startupScanScopes stays at its default.
        'extensions.autoDisableScopes': 0,
        'app.update.auto': False,
        'extensions.logging.enabled': True,
        'extensions.zotero.debug.log': True,
        'extensions.zotero.paperbridge.pairingToken': 'restart-audit-only',
    }
    (profile / 'user.js').write_text('\n'.join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k,v in prefs.items()), encoding='utf-8')
    anchors=[]
    if os.environ.get('BRIDGE_AUDIT_PDF'):
        browser_result=next(json.loads(line) for line in (root/'.cache/rematch-browser-results.txt').read_text(encoding='utf-8-sig').splitlines() if line.startswith('{"passed"'))
        anchors=browser_result['anchors'][:3]+[browser_result['anchors'][-1]]
    bootstrap = script.replace('DATA', json.dumps(str(data))).replace('RESULT', json.dumps(str(folder/'result.json'))).replace('XPI', json.dumps(str(root/'dist'/f'translate-bridge-zotero-{version}.xpi'))).replace('PDF_PATH',json.dumps(os.environ.get('BRIDGE_AUDIT_PDF',''))).replace('ANCHORS',json.dumps(anchors))
    with ZipFile(profile/'extensions'/'restart-audit@local.research.xpi','w',ZIP_DEFLATED) as z:
        with ZipFile(root/'dist'/f'translate-bridge-zotero-{version}.xpi') as original:
            manifest=json.loads(original.read('manifest.json'))
            manifest['name']='Isolated restart probe'
            manifest['applications']['zotero']['id']='restart-audit@local.research'
            manifest['applications']['zotero']['update_url']='https://example.invalid/restart-audit-updates.json'
            for name in original.namelist():
                if name not in ('manifest.json','bootstrap.js'):
                    z.writestr(name,original.read(name))
        z.writestr('manifest.json',json.dumps(manifest))
        z.writestr('bootstrap.js',bootstrap)
    shutil.copy2(profile/'extensions'/'restart-audit@local.research.xpi',folder/'probe.xpi')
print(base)
