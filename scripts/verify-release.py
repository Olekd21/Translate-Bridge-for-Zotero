"""Check the distributable, including the nested XPI, without extracting files."""
import io
import json
import hashlib
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
extension = json.loads((root / "packages/browser-extension/manifest.json").read_text(encoding="utf-8"))
addon = json.loads((root / "packages/zotero-addon/package.json").read_text(encoding="utf-8"))
bundle = root / "dist" / f"translate-bridge-for-zotero-{extension['version']}.zip"
folder = f"Translate-Bridge-Chrome-{extension['version']}/"
xpi_name = f"Translate-Bridge-Zotero-{addon['version']}.xpi"

with ZipFile(bundle) as z:
    assert z.testzip() is None
    names = {n.replace("\\", "/"): n for n in z.namelist()}
    assert all(not PurePosixPath(n).is_absolute() and ".." not in PurePosixPath(n).parts for n in names)
    assert all(n.startswith(folder) or n in {xpi_name, "START-HERE.html", "USER-MANUAL.md"} for n in names), names
    assert not any(part in n.lower() for n in names for part in ["prefs.js", "auth.json", ".sqlite", ".env", "node_modules", "outbox"])
    read = lambda name: z.read(names[name])
    manifest = json.loads(read(folder + "manifest.json"))
    assert manifest == extension
    assert f'const currentVersion = "{extension["version"]}"' in read(folder + "content.js").decode()
    for item in [manifest["background"]["service_worker"], manifest["options_page"], *manifest["icons"].values()]:
        assert folder + item in names, item
    guide = read("START-HERE.html")
    assert guide == (root / "docs/开始使用.html").read_bytes()
    assert read("USER-MANUAL.md") == (root / "docs/用户手册.md").read_bytes()
    assert xpi_name.encode() in guide and folder[:-1].encode() in guide
    for term in ["Translator", "Connector", "LLM-for-Zotero", "前 5 页", "复制配对码"]:
        assert term in guide.decode("utf-8"), term
    with ZipFile(io.BytesIO(read(xpi_name))) as xpi:
        assert xpi.testzip() is None
        xm = json.loads(xpi.read("manifest.json"))
        assert xm["version"] == addon["version"]
        assert xm["applications"]["zotero"]["id"] == addon["config"]["addonID"]
        assert xpi.read("content/user-guide.html") == guide
        for f in ["guide.html", "guide.js", "guide.css", "icons/favicon.png", "icons/favicon@0.5x.png"]:
            assert xpi.read("content/" + f), f
        assert 'pref("extensions.zotero.paperbridge.pairingToken", "")' in xpi.read("prefs.js").decode()
        js = xpi.read("content/scripts/paperbridge.js").decode()
        for term in ["paperbridge-toolbar-read", "paperbridge-toolbar-help", "nextPageRects"]:
            assert term in js, term

print(json.dumps({"bundle": str(bundle), "chrome": extension["version"], "zotero": addon["version"], "bytes": bundle.stat().st_size, "sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(), "checks": "ZIP integrity, paths, versions, resources, both manuals, empty pairing default, no personal profile files: passed"}, ensure_ascii=False, indent=2))
