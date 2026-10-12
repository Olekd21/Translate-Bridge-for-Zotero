export default async page => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const result = await page.evaluate(async () => {
    const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
    const english = [
      "Cardiac lymphatics emerge at E12.5 near the outflow tract and populate the dorsal ventricle by E14.5.13",
      "The nascent lymphatics sprout from the sinus venosus region, as well as isolated Prox1 (prospero homeobox 1)+ LECs and LEC clusters, during a critical period in the establishment of the cardiac lymphatic network.14",
      "By E18.5, the ventricular cardiac lymphatic network is established.13",
    ];
    const chinese = [
      "心脏淋巴管在胚胎第12.5天于流出道附近出现，并在胚胎第14.5天到达背侧脑室。",
      "在心脏淋巴网络建立的关键时期，新生淋巴管从静脉窦区域以及孤立的Prox1阳性淋巴内皮细胞和细胞簇中萌发。",
      "到胚胎第18.5天，心室心脏淋巴网络形成完成。",
    ];
    const paragraph = document.createElement("div");
    paragraph.setAttribute("role", "paragraph");
    paragraph.textContent = english.join(" ");
    document.getElementById("paper").append(paragraph);
    await wait(180);
    const markers = [...paragraph.querySelectorAll("[data-pb-sentence]")];
    if (markers.length !== 3)
      throw new Error(`numeric citation source split into ${markers.length} markers`);
    markers.forEach((marker, index) => {
      marker.replaceChildren(document.createTextNode(chinese[index]));
      const reference = document.createElement("a");
      reference.setAttribute("role", "doc-noteref");
      reference.href = `#ref-${index + 1}`;
      reference.textContent = ["13", "14", "13"][index];
      const sup = document.createElement("sup");
      sup.append(reference);
      marker.append(" ", sup);
    });
    await wait(80);
    const range = document.createRange();
    range.setStart(markers[0].firstChild, 0);
    range.setEnd(markers[2].firstChild, markers[2].firstChild.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await wait(120);
    if (document.querySelector(".pb-panel").dataset.open !== "true")
      document.querySelector(".pb-selection-button").click();
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!document.querySelector(".pb-source").textContent.startsWith("正在匹配")) break;
      await wait(50);
    }
    return {
      markerCount: markers.length,
      source: document.querySelector(".pb-source").textContent,
      status: document.querySelector(".pb-status").textContent,
      openDisabled: document.querySelector(".pb-open-selection").disabled,
      syncDisabled: document.querySelector(".pb-sync").disabled,
    };
  });
  if (errors.length) throw new Error(errors.join("\n"));
  const expected = [
    "Cardiac lymphatics emerge at E12.5 near the outflow tract and populate the dorsal ventricle by E14.5.13",
    "The nascent lymphatics sprout from the sinus venosus region, as well as isolated Prox1 (prospero homeobox 1)+ LECs and LEC clusters, during a critical period in the establishment of the cardiac lymphatic network.14",
    "By E18.5, the ventricular cardiac lymphatic network is established.13",
  ].join(" ");
  if (result.source !== expected || result.openDisabled || result.syncDisabled)
    throw new Error(`numeric citation selection failed: ${JSON.stringify(result)}`);
  return {
    ...result,
    passed: [
      "E14.5 remains an embryonic decimal timepoint",
      "the following .13 citation closes the first sentence",
      "three translated sentences recover three exact English sentences",
      "omitting the final visible reference from the selection remains safe",
    ],
    errors,
  };
}
