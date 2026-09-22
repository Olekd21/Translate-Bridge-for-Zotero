import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("packages/browser-extension");
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "manifest.json"), "utf8"),
);
const required = [
  manifest.background?.service_worker,
  manifest.options_page,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => [
    ...(entry.js || []),
    ...(entry.css || []),
  ]),
].filter(Boolean);
const uniqueRequired = [...new Set(required)];

const missing = [];
for (const relativePath of uniqueRequired) {
  try {
    await fs.access(path.join(root, relativePath));
  } catch {
    missing.push(relativePath);
  }
}

if (missing.length) {
  throw new Error(`Manifest references missing files: ${missing.join(", ")}`);
}

for (const [declaredSize, relativePath] of Object.entries(
  manifest.icons || {},
)) {
  const image = await fs.readFile(path.join(root, relativePath));
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  const expected = Number(declaredSize);
  if (width !== expected || height !== expected) {
    throw new Error(
      `Icon ${relativePath} is ${width}x${height}, expected ${expected}x${expected}`,
    );
  }
}

const contentScript = await fs.readFile(path.join(root, "content.js"), "utf8");
const declaredColors = new Set(
  [...contentScript.matchAll(/\{ value: "(#[0-9a-f]{6})", label: /gi)].map(
    (match) => match[1].toLowerCase(),
  ),
);
if (declaredColors.size !== 8) {
  throw new Error(`Expected 8 highlight colors, found ${declaredColors.size}`);
}

console.log(
  `Chrome extension manifest is internally consistent (${uniqueRequired.length} referenced files, ${declaredColors.size} highlight colors).`,
);
