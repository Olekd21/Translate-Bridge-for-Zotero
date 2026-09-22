import { config } from "../../package.json";
import { getOrCreatePairingToken } from "./bridgeServer";

const icon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
const contentRoot = `chrome://${config.addonRef}/content/`;

export function articleURL(item: any): string {
  const url = String(item?.getField?.("url") || "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  const doi = String(item?.getField?.("DOI") || "")
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(doi)
    ? `https://doi.org/${encodeURI(doi).replace(/#/g, "%23").replace(/\?/g, "%3F")}`
    : "";
}

export function registerReadingUI(win: _ZoteroTypes.MainWindow): () => void {
  const doc = win.document;
  const owned: Element[] = [];
  const listeners: Array<() => void> = [];
  const dialogs = new Set<Window>();
  let guide: Window | null = null;
  const create = (tag: string, id: string, label = "") => {
    const node = doc.createXULElement(tag);
    node.id = id;
    if (label) node.setAttribute("label", label);
    return node;
  };
  const on = (node: EventTarget, event: string, callback: EventListener) => {
    node.addEventListener(event, callback);
    listeners.push(() => node.removeEventListener(event, callback));
  };
  const selected = () => {
    const items = win.ZoteroPane.getSelectedItems();
    if (items.length !== 1) return null;
    const item = items[0];
    return item.parentID ? Zotero.Items.get(item.parentID) : item;
  };
  const notify = (text: string, error = false) => {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text, type: error ? "fail" : "success" })
      .show()
      .startCloseTimer(5000);
  };
  const copyCode = () => {
    new ztoolkit.Clipboard()
      .addText(getOrCreatePairingToken(), "text/unicode")
      .copy();
    notify(
      "配对码已复制。打开 Chrome 的 Translate Bridge for Zotero 设置，粘贴后点击“保存并测试”。",
    );
  };
  const openArticle = () => {
    const item = selected();
    if (!item) {
      notify("请先在文献列表中选择一篇论文，再点击“网页阅读”。", true);
      return false;
    }
    const target = articleURL(item);
    if (!target) {
      notify(
        "该论文没有可用的网址或 DOI。请在右侧条目信息中补充后重试。",
        true,
      );
      return false;
    }
    Zotero.launchURL(target);
    notify(
      "已交给默认浏览器。请用 Chrome 打开，选择正文后点击 Translate Bridge for Zotero 做笔记。",
    );
    return true;
  };
  const openManual = () => {
    const dialog = win.openDialog(
      `${contentRoot}user-guide.html`,
      "",
      "chrome,centerscreen,resizable,width=840,height=760",
    );
    if (dialog) dialogs.add(dialog);
  };
  const openGuide = () => {
    if (guide && !guide.closed) {
      guide.focus();
      return;
    }
    guide = win.openDialog(
      `${contentRoot}guide.html`,
      "",
      "chrome,centerscreen,resizable,width=640,height=720",
      { copyCode, openArticle, openManual },
    );
    if (guide) dialogs.add(guide);
  };
  const menuItem = (id: string, label: string, action: () => void) => {
    const node = create("menuitem", id, label);
    node.setAttribute("class", "menuitem-iconic");
    node.setAttribute("image", icon);
    node.setAttribute("style", `list-style-image: url("${icon}");`);
    on(node, "command", action);
    return node;
  };

  const itemMenu = doc.getElementById("zotero-itemmenu");
  if (itemMenu) {
    const read = menuItem(
      "paperbridge-open-official-page",
      "Translate Bridge for Zotero · 在浏览器中阅读",
      openArticle,
    );
    read.setAttribute(
      "tooltiptext",
      "打开所选论文的网页全文，在 Chrome 翻译、做笔记并同步到 Zotero PDF。",
    );
    // Zotero addresses its own menu children by index. Always append, never
    // insert before the built-in entries or move them to improve visibility.
    itemMenu.appendChild(read);
    owned.push(read);
    on(itemMenu, "popupshowing", () => {
      read.setAttribute("disabled", String(!selected()));
    });
  }

  const toolsMenu = doc.getElementById("menu_ToolsPopup");
  if (toolsMenu) {
    const menu = create("menu", "paperbridge-tools-menu", "Translate Bridge for Zotero");
    menu.setAttribute("class", "menu-iconic");
    menu.setAttribute("image", icon);
    menu.setAttribute("style", `list-style-image: url("${icon}");`);
    const popup = create("menupopup", "paperbridge-tools-popup");
    popup.append(
      menuItem("paperbridge-tools-read", "在浏览器中阅读所选论文", openArticle),
      menuItem("paperbridge-guide", "开始使用与配对…", openGuide),
      menuItem("paperbridge-copy-pairing-token", "复制配对码", copyCode),
      menuItem("paperbridge-user-manual", "用户手册与依赖说明…", openManual),
    );
    menu.appendChild(popup);
    toolsMenu.appendChild(menu);
    owned.push(menu);
  }

  const toolbar = doc.getElementById("zotero-items-toolbar");
  if (toolbar) {
    const group = create("hbox", "paperbridge-toolbar");
    group.setAttribute("align", "center");
    const read = create(
      "toolbarbutton",
      "paperbridge-toolbar-read",
      "网页阅读",
    );
    read.setAttribute("class", "zotero-tb-button");
    read.setAttribute("image", icon);
    read.setAttribute(
      "tooltiptext",
      "Translate Bridge for Zotero：选中一篇论文，点击此处在浏览器中阅读。",
    );
    read.setAttribute("aria-label", "Translate Bridge for Zotero 网页阅读");
    read.setAttribute("tabindex", "0");
    const help = create("toolbarbutton", "paperbridge-toolbar-help", "?");
    help.setAttribute("tooltiptext", "Translate Bridge for Zotero：开始使用、配对和依赖说明");
    help.setAttribute("aria-label", "Translate Bridge for Zotero 使用指南");
    help.setAttribute("tabindex", "0");
    on(read, "command", openArticle);
    on(help, "command", openGuide);
    group.append(read, help);
    toolbar.appendChild(group);
    owned.push(group);
    const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
    style.textContent = `
      #paperbridge-toolbar { margin-inline: 6px; flex-shrink: 0; }
      #paperbridge-toolbar-read { padding: 3px 6px; }
      #paperbridge-toolbar-read .toolbarbutton-icon { width: 18px; height: 18px; }
      #paperbridge-toolbar-read .toolbarbutton-text { display: inline !important; margin-inline-start: 5px; }
      #paperbridge-toolbar-help { min-width: 24px; padding: 3px; }
      #paperbridge-toolbar-help .toolbarbutton-text { display: inline !important; }
      #paperbridge-toolbar-help .toolbarbutton-icon { display: none; }
    `;
    doc.documentElement?.appendChild(style);
    owned.push(style);
  }
  return () => {
    listeners.forEach((remove) => remove());
    owned.forEach((node) => node.remove());
    dialogs.forEach((dialog) => {
      if (!dialog.closed) dialog.close();
    });
  };
}
