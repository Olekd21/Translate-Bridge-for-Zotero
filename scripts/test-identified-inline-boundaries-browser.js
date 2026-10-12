export default async page => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result = await page.evaluate(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
    const english = [
      "The heart has a complex network of lymphatic vessels that are essential for the maintenance of tissue fluid balance, immune cell trafficking, and cardiac function.",
      "Several lymphatic markers, including LYVE-1, Pdpn, Prox1, CCL21, and VEGFR-3, have been identified and are highly expressed in all lymphatic vessels.",
      "VEGF family members are key mediators of angiogenesis and lymphangiogenesis.",
      "VEGFR-3 was the first identified lymphatic-specific growth factor receptor.",
      "VEGF-C/D and VEGFR-3 are the main components of the apical signaling pathway for lymphatic vessel development and maintenance.",
      "Additionally, VEGF-C attracts macrophages, and VEGFR-3 is highly expressed in peripheral monocytes and tissue macrophages.",
      "Interestingly, loss of VEGF-C function inhibits lymphatic vessel growth, while VEGFR-3 deficiency causes vascular defects and embryonic death.",
      "VEGF-C mutation in human patients is associated with autosomal dominant Milroy-like primary lymphedema.",
      "Importantly, lymphatic vessel dysfunction is involved in lymphedema, chylothorax, inflammation, and tumor metastasis.",
      "Recent studies link cardiac lymphangiogenesis, edema, and contractile dysfunction after myocardial injury.",
      "Stimulation of cardiac lymphangiogenesis improves transport and edema and reduces inflammation and fibrosis.",
      "Conversely, inhibition of cardiac lymphangiogenesis impairs transport and aggravates related processes.",
      "However, the role of the VEGF-C-VEGFR-3 axis in pressure overload remains unknown.",
    ];
    const chinese = [
      "心脏拥有复杂的淋巴管网络，该网络对于维持组织液平衡、免疫细胞运输和心脏功能至关重要。",
      "已鉴定出多种淋巴标志物，包括LYVE-1、Pdpn、Prox1、CCL21和VEGFR-3，这些标志物在所有淋巴管中均高表达。",
      "据报道，VEGF家族成员是血管生成和淋巴管生成的关键介质。",
      "VEGFR-3是第一个被鉴定的淋巴特异性生长因子受体。",
      "VEGF-C/D和VEGFR-3是淋巴管发育和维持信号通路的主要组成部分。",
      "此外，VEGF-C能够吸引巨噬细胞，而VEGFR-3在单核细胞和巨噬细胞中高表达。",
      "有趣的是，VEGF-C功能丧失会抑制淋巴管生长，而VEGFR-3缺陷会导致血管缺陷和胚胎死亡。",
      "人类患者的VEGF-C突变与常染色体显性遗传的原发性淋巴水肿相关。",
      "重要的是，淋巴管功能障碍与淋巴水肿、乳糜胸、炎症和肿瘤转移有关。",
      "近期研究发现心脏淋巴管生成、水肿和心肌损伤后收缩功能障碍之间存在关联。",
      "刺激心脏淋巴管生成可改善运输和水肿，并减少炎症和纤维化。",
      "相反，抑制心脏淋巴管生成会损害运输并加剧相关过程。",
      "然而，VEGF-C-VEGFR-3轴在压力负荷中的作用仍不清楚。",
    ];
    const paragraph = document.createElement("p");
    paragraph.id = "wiley-identified-inline-paragraph";
    english.forEach((sentence, index) => {
      const pivot = Math.floor(sentence.length / 2);
      const first = document.createElement("span");
      first.id = `wiley-inline-${index}-a`;
      first.textContent = sentence.slice(0, pivot);
      const second = document.createElement("span");
      second.id = `wiley-inline-${index}-b`;
      second.textContent = sentence.slice(pivot);
      paragraph.append(first, second, " ");
    });
    document.getElementById("paper").append(paragraph);
    await wait(180);
    const sourceAnchors = paragraph.querySelectorAll("[data-pb-sentence]");
    if (sourceAnchors.length !== english.length)
      throw new Error(`identified inline boundaries produced ${sourceAnchors.length} source markers`);
    if (new Set([...paragraph.querySelectorAll("[id]")].map(node => node.id)).size !== english.length * 2)
      throw new Error("publisher inline IDs were duplicated or removed");

    [...sourceAnchors].forEach((marker, index) => marker.textContent = chinese[index]);
    await wait(80);
    const markers = [...paragraph.querySelectorAll("[data-pb-sentence]")];
    const range = document.createRange();
    range.setStart(markers[0].firstChild, 0);
    range.setEnd(markers[1].firstChild, markers[1].firstChild.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await wait(140);
    if (document.querySelector(".pb-panel").dataset.open !== "true")
      document.querySelector(".pb-selection-button").click();
    await wait(100);
    return {
      markerCount: markers.length,
      source: document.querySelector(".pb-source").textContent,
      status: document.querySelector(".pb-status").textContent,
      openDisabled: document.querySelector(".pb-open-selection").disabled,
      duplicateIds: [...paragraph.querySelectorAll("[id]")]
        .map(node => node.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
    };
  });
  if (errors.length) throw new Error(errors.join("\n"));
  const expected = [
    "The heart has a complex network of lymphatic vessels that are essential for the maintenance of tissue fluid balance, immune cell trafficking, and cardiac function.",
    "Several lymphatic markers, including LYVE-1, Pdpn, Prox1, CCL21, and VEGFR-3, have been identified and are highly expressed in all lymphatic vessels.",
  ].join(" ");
  if (result.source !== expected || result.openDisabled || result.duplicateIds.length)
    throw new Error(`identified inline selection failed: ${JSON.stringify(result)}`);
  return {
    ...result,
    passed: [
      "13 source sentences crossing publisher ID wrappers retain sentence markers",
      "publisher IDs remain unique after range wrapping",
      "the first two Google-style Chinese sentences recover two exact English sentences",
    ],
    errors,
  };
}
