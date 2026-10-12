import { config } from "../../package.json";
import { articleURL } from "./readingUI";
import { queueWebSelection } from "./bridgeServer";

export function registerReaderUI() {
  const nodes = new Set<any>();
  const listeners: [string, (event:any)=>void][] = [];
  let stopped = false;
  function pruneNodes() {
    for (const node of nodes) if (!node.isConnected) nodes.delete(node);
  }
  async function openReaderArticle(reader:any, exact:string) {
    const itemID = reader?.itemID ?? reader?._itemID ?? reader?._item?.id;
    let attachment = itemID ? Zotero.Items.get(itemID) : reader?._item;
    if (!attachment && itemID && typeof Zotero.Items.getAsync === "function")
      attachment = await Zotero.Items.getAsync(itemID);
    let item = attachment?.parentID ? Zotero.Items.get(attachment.parentID) : attachment;
    if (!item && attachment?.parentID && typeof Zotero.Items.getAsync === "function")
      item = await Zotero.Items.getAsync(attachment.parentID);
    const url = articleURL(item);
    if (!url) {
      new ztoolkit.ProgressWindow(config.addonName)
        .createLine({text:"此论文缺少网页地址或DOI，或条目尚未加载完成",type:"fail"})
        .show().startCloseTimer(5000);
      return;
    }
    const ticket = exact ? queueWebSelection(exact,String(item.getField("DOI")||""),url) : null;
    Zotero.launchURL(ticket ? url.split("#")[0]+"#pb-web="+ticket : url);
  }
  function buttonFor(reader:any, doc:any, exact = "") {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "paperbridge-reader-web";
    button.setAttribute("data-pb-reader-action", exact ? "selection" : "toolbar");
    button.title = exact ? "网页阅读：定位所选文字" : "网页阅读：打开当前论文";
    button.setAttribute("aria-label", button.title);
    // Content documents cannot reliably load privileged chrome:// images.
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("width", "24"); svg.setAttribute("height", "24");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "display:block;flex:none;width:24px;height:24px";
    const rect = doc.createElementNS(svg.namespaceURI, "rect");
    for (const [key,value] of Object.entries({x:"1",y:"1",width:"34",height:"34",rx:"10",fill:"#087bff"})) rect.setAttribute(key,value);
    const path = doc.createElementNS(svg.namespaceURI, "path");
    for (const [key,value] of Object.entries({d:"M8.5 23.5c2.6-7.2 7.2-10.8 9.5-10.8s6.9 3.6 9.5 10.8M9 20.8v5.1M27 20.8v5.1",fill:"none",stroke:"white","stroke-width":"2.5","stroke-linecap":"round"})) path.setAttribute(key,value);
    svg.append(rect,path);
    const label = doc.createElement("span"); label.textContent = "网页阅读";
    button.append(svg,label);
    button.style.cssText = "display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:none;width:auto;min-width:96px;height:32px;padding:3px 8px;border:1px solid rgba(8,123,255,.22);border-radius:6px;background:rgba(8,123,255,.07);color:inherit;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer";
    let opening = false;
    let pointerActivation = 0;
    const activate = async () => {
      if (opening) return;
      opening = true;
      button.setAttribute("aria-busy", "true");
      try { await openReaderArticle(reader,exact); }
      finally { opening = false; button.setAttribute("aria-busy", "false"); }
    };
    // Reader toolbars can be rebuilt between pointerdown and click. Launch on
    // pointerdown so one physical press is sufficient, and retain click for
    // keyboard, assistive-technology and programmatic activation.
    button.addEventListener("pointerdown", (event:any) => {
      if (event.button !== 0) return;
      pointerActivation = Date.now();
      void activate();
    });
    button.addEventListener("click", () => {
      if (Date.now() - pointerActivation < 750) return;
      void activate();
    });
    nodes.add(button);
    return button;
  }
  function mountToolbar(reader:any, doc:any) {
    if (stopped || !doc?.querySelector) return;
    const slot = doc.querySelector(".toolbar .end .custom-sections") || doc.querySelector(".toolbar .end");
    if (!slot || doc.querySelector('[data-pb-reader-action="toolbar"]')) return;
    slot.append(buttonFor(reader,doc));
  }
  for (const type of ["renderToolbar", "renderTextSelectionPopup"]) {
    const handler = ({reader,doc,params,append}:any) => {
      if (stopped) return;
      pruneNodes();
      if (type === "renderToolbar") { mountToolbar(reader,doc); return; }
      const exact = String(params?.annotation?.text || "").trim();
      if (exact) append(buttonFor(reader,doc,exact));
    };
    (Zotero.Reader as any).registerEventListener(type,handler,config.addonID);
    listeners.push([type,handler]);
  }
  // The toolbar may already exist when the add-on starts or is upgraded.
  for (const reader of (Zotero.Reader as any)._readers || []) {
    const doc = reader._iframeWindow?.document;
    if (doc) mountToolbar(reader,doc);
  }
  return () => {
    stopped = true;
    const readerAPI = Zotero.Reader as any;
    // Affected reader builds have an unregister filter that removes other
    // add-ons' listeners. Remove only these exact callback identities.
    if (Array.isArray(readerAPI._registeredListeners)) {
      readerAPI._registeredListeners = readerAPI._registeredListeners.filter((entry:any) => !listeners.some(([type,handler]) => entry.type === type && entry.handler === handler));
    } else for (const [type,handler] of listeners) readerAPI.unregisterEventListener(type,handler);
    for (const node of nodes) node.remove();
    nodes.clear();
  };
}
