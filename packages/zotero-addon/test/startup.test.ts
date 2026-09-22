import { assert } from "chai";
import { config } from "../package.json";
import { annotationComment } from "../src/modules/bridgeServer";
import { locateQuoteGeometry } from "../src/modules/pdfGeometry";

function recognizerWord(x: number, y: number, text: string, spaceAfter = true) {
  return [
    x,
    y,
    x + Math.max(18, text.length * 4),
    y + 10,
    10,
    spaceAfter ? 1 : 0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    text,
  ];
}

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should place the personal note before the Chinese translation", function () {
    const comment = annotationComment({
      schemaVersion: 1,
      id: "test-annotation",
      createdAt: "2026-09-22T00:00:00.000Z",
      document: {},
      selector: { type: "TextQuoteSelector", exact: "Original text" },
      comment: "这段很重要",
      translation: "中文译文",
    });

    assert.equal(comment, "我的笔记：\n这段很重要\n\n中文翻译：\n中文译文");
  });

  it("should locate glued text across interleaved PDF columns", function () {
    const lines = [
      [
        [
          recognizerWord(
            40,
            100,
            "The heart has a complex network of lymphatic ves-",
            false,
          ),
        ],
      ],
      [[recognizerWord(340, 100, "andcardiacfunction. However this", false)]],
      [[recognizerWord(40, 120, "sels that maintain fluid balance", false)]],
      [[recognizerWord(340, 120, "roleremainsunknown.", false)]],
    ];
    const page = [600, 800, [[[[0, 0, 0, 0, lines]]]]];
    const match = locateQuoteGeometry(
      { pages: [page] },
      {
        type: "TextQuoteSelector",
        exact:
          "The heart has a complex network of lymphatic vessels that maintain fluid balance and cardiac function. However this role remains unknown.",
      },
    );

    assert.equal(match.pageIndex, 0);
    assert.equal(match.method, "column-compact-character-sequence");
    assert.isNotEmpty(match.rects);
  });
});
