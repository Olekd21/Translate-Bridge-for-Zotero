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
