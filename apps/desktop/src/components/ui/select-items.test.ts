import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, selectItemsFromChildren } from "./select";

describe("selectItemsFromChildren", () => {
  it("maps item values to labels so the closed trigger can show translated text", () => {
    const tree = createElement(
      SelectContent,
      null,
      createElement(SelectItem, { value: "system" }, "跟随系统"),
      createElement(SelectItem, { value: "zh" }, "简体中文"),
    );
    expect(selectItemsFromChildren(tree)).toEqual({
      system: "跟随系统",
      zh: "简体中文",
    });
  });

  it("walks fragments and ignores non-string values", () => {
    const tree = createElement(
      Fragment,
      null,
      createElement(SelectItem, { value: "light" }, "浅色"),
      createElement(SelectItem, { value: 1 }, "skipped"),
    );
    expect(selectItemsFromChildren(tree)).toEqual({ light: "浅色" });
  });

  it("returns undefined when there is nothing to label", () => {
    expect(selectItemsFromChildren(null)).toBeUndefined();
  });

  it("renders the item label in the trigger instead of the raw value", () => {
    const html = renderToStaticMarkup(
      createElement(
        Select,
        { value: "system", onValueChange: () => {} },
        createElement(SelectTrigger, null, createElement(SelectValue)),
        createElement(SelectContent, null, createElement(SelectItem, { value: "system" }, "跟随系统")),
      ),
    );
    expect(html).toContain("跟随系统");
  });
});
