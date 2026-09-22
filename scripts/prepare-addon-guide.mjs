import { copyFile, mkdir } from "node:fs/promises";
const target = new URL(
  "../packages/zotero-addon/addon/content/",
  import.meta.url,
);
await mkdir(target, { recursive: true });
await copyFile(
  new URL("../docs/开始使用.html", import.meta.url),
  new URL("user-guide.html", target),
);
console.log("Bundled the current user manual into the Zotero add-on.");
await mkdir(new URL("licenses/", target), {recursive:true});
for (const [name,file] of [
  ["pdf-lib", "LICENSE.md"], ["@pdf-lib/standard-fonts", "LICENSE.md"],
  ["@pdf-lib/upng", "LICENSE"], ["pako", "LICENSE"], ["tslib", "LICENSE.txt"],
]) {
  await copyFile(new URL(`../packages/zotero-addon/node_modules/${name}/${file}`, import.meta.url),
    new URL(`licenses/${name.replace(/[@/]/g,'-')}.txt`, target));
}
