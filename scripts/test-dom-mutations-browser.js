async (page) => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => route.continue());
  await page.goto("http://127.0.0.1:18841/fixtures/aha-chinese-rematch.html");
  const english = "Cardiac function recovered after pressure overload was relieved.";
  await page.evaluate(english => {
    // MutationObserver runs later: both queued records refer to detached text.
    const transient = document.createTextNode("temporary text");
    document.body.append(transient);
    transient.data = "changed temporary text";
    transient.remove();
    // The same batch must still capture the next valid English paragraph.
    const paragraph = document.createElement("p");
    paragraph.id = "mutation-survivor";
    paragraph.textContent = english;
    document.body.append(paragraph);
  }, english);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const p = document.getElementById("mutation-survivor");
    p.textContent = "解除压力负荷后心脏功能恢复。";
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForTimeout(80);
  await page.locator(".pb-selection-button").click();
  await page.waitForTimeout(200);
  const recovered = await page.locator(".pb-source").textContent();
  return { errors, recovered, expected: english, passed: errors.length === 0 && recovered === english };
}
