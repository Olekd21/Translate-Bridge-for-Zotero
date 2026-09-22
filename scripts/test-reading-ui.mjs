import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import fs from "node:fs/promises";
import { build } from "../packages/zotero-addon/node_modules/esbuild/lib/main.js";

const compiled = await build({
  entryPoints: ["packages/zotero-addon/src/modules/readingUI.ts"],
  bundle: true,
  format: "iife",
  globalName: "ReadingUI",
  write: false,
});
class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
  }
  setAttribute(key, value) {
    this.attrs[key] = value;
  }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(n));
  }
  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
  remove() {
    this.parent.children = this.parent.children.filter((n) => n !== this);
  }
}
function setup() {
  const root = new Element("window");
  for (const id of [
    "zotero-itemmenu",
    "menu_ToolsPopup",
    "zotero-items-toolbar",
  ]) {
    const n = new Element("box");
    n.id = id;
    root.append(n);
    const builtin = new Element("menuitem");
    builtin.id = `${id}-builtin`;
    n.append(builtin);
  }
  const find = (id, node = root) =>
    node.id === id ? node : node.children.map((n) => find(id, n)).find(Boolean);
  const doc = {
    documentElement: root,
    createXULElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    getElementById: find,
  };
  let selection = [];
  const urls = [],
    dialogs = [],
    notices = [],
    copied = [];
  const parent = {
    getField: (key) => (key === "url" ? "https://example.org/paper" : ""),
  };
  const win = {
    document: doc,
    ZoteroPane: { getSelectedItems: () => selection },
    openDialog: (...args) => {
      const dialog = {
        args,
        closed: false,
        focus() {
          this.focused = true;
        },
        close() {
          this.closed = true;
        },
      };
      dialogs.push(dialog);
      return dialog;
    },
  };
  const context = vm.createContext({
    Zotero: {
      Items: { get: () => parent },
      launchURL: (url) => urls.push(url),
      Prefs: { get: () => "test-only-pairing-value" },
    },
    ztoolkit: {
      Clipboard: class {
        addText(value) {
          copied.push(value);
          return this;
        }
        copy() {}
      },
      ProgressWindow: class {
        createLine(value) {
          notices.push(value.text);
          return this;
        }
        show() {
          return this;
        }
        startCloseTimer() {}
      },
    },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  const cleanup = context.ReadingUI.registerReadingUI(win);
  return {
    root,
    find,
    urls,
    dialogs,
    notices,
    copied,
    parent,
    cleanup,
    api: context.ReadingUI,
    select: (values) => {
      selection = values;
    },
    command: (id) => find(id).dispatchEvent(new Event("command")),
  };
}

test("menu has brand icon and never displaces Zotero built-in entries", () => {
  const h = setup();
  assert.equal(
    h.find("zotero-itemmenu").children[0].id,
    "zotero-itemmenu-builtin",
  );
  assert.match(h.find("paperbridge-open-official-page").attrs.image, /favicon/);
  assert.match(
    h.find("paperbridge-open-official-page").attrs.label,
    /Translate Bridge for Zotero/,
  );
  assert.equal(h.find("paperbridge-toolbar-read").attrs.label, "网页阅读");
  h.cleanup();
  assert.equal(h.find("paperbridge-toolbar-read"), undefined);
  assert.equal(h.find("paperbridge-tools-menu"), undefined);
  assert.ok(h.find("zotero-itemmenu-builtin"));
});
test("empty and multiple selection give guidance; attached PDF opens its parent URL", () => {
  const h = setup();
  h.command("paperbridge-toolbar-read");
  assert.equal(h.urls.length, 0);
  assert.match(h.notices.at(-1), /选择一篇/);
  h.select([h.parent, h.parent]);
  h.command("paperbridge-toolbar-read");
  assert.equal(h.urls.length, 0);
  h.select([{ parentID: 42 }]);
  h.command("paperbridge-toolbar-read");
  assert.deepEqual(h.urls, ["https://example.org/paper"]);
});
test("missing metadata explains how to repair it instead of silently doing nothing", () => {
  const h = setup();
  h.select([{ getField: () => "" }]);
  h.command("paperbridge-open-official-page");
  assert.equal(h.urls.length, 0);
  assert.match(h.notices.at(-1), /右侧条目信息/);
});
test("guide actions copy a code, open an article and open the packaged manual", () => {
  const h = setup();
  h.command("paperbridge-toolbar-help");
  h.command("paperbridge-guide");
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].focused, true);
  const actions = h.dialogs[0].args[3];
  actions.copyCode();
  assert.equal(h.copied.length, 1);
  assert.equal(actions.openArticle(), false);
  h.select([h.parent]);
  assert.equal(actions.openArticle(), true);
  actions.openManual();
  assert.match(h.dialogs[1].args[0], /user-guide.html$/);
  h.cleanup();
  assert.ok(h.dialogs.every((d) => d.closed));
});
test("DOI fallback handles prefixed DOI and rejects non-web addresses", () => {
  const { api } = setup();
  const fields = (data) => ({ getField: (key) => data[key] || "" });
  assert.equal(
    api.articleURL(fields({ DOI: "https://doi.org/10.1002/ctm2.374" })),
    "https://doi.org/10.1002/ctm2.374",
  );
  assert.equal(
    api.articleURL(
      fields({ url: "javascript:alert(1)", DOI: "doi:10.1002/ctm2.374" }),
    ),
    "https://doi.org/10.1002/ctm2.374",
  );
  assert.equal(api.articleURL(fields({ url: "file:///private.pdf" })), "");
});
test("guide reports invalid selection honestly and disables actions in standalone preview", async () => {
  const source = await fs.readFile(
    "packages/zotero-addon/addon/content/guide.js",
    "utf8",
  );
  const buttons = Object.fromEntries(
    ["copy-code", "open-article", "open-manual"].map((id) => [
      id,
      new Element("button"),
    ]),
  );
  const status = {};
  const doc = {
    querySelector: () => status,
    getElementById: (id) => buttons[id],
  };
  vm.runInNewContext(source, {
    document: doc,
    window: {
      arguments: [{ copyCode() {}, openArticle: () => false, openManual() {} }],
    },
  });
  buttons["open-article"].dispatchEvent(new Event("click"));
  assert.match(status.textContent, /请先在 Zotero/);
  vm.runInNewContext(source, { document: doc, window: {} });
  assert.ok(Object.values(buttons).every((b) => b.disabled));
});
