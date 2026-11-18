import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyIcon, LanguagesIcon, SearchIcon } from "@/components/animated-icons";

import { BarFace } from "./faces";

describe("bar content motion", () => {
  for (const direction of ["left", "right"] as const) {
    it(`keeps ${direction}-opening buttons opaque and free of layout transforms`, () => {
      const markup = renderToStaticMarkup(<BarFace hovered={null} direction={direction} />);
      const buttons = markup.match(/<button[^>]*>/g) ?? [];
      expect(buttons).toHaveLength(4);
      for (const button of buttons) {
        expect(button).not.toContain("opacity");
        expect(button).not.toContain("transform");
      }
      expect(markup).not.toContain("data-projection-id");
      expect(markup.match(/class="action-title"/g)).toHaveLength(4);
      expect(markup.match(/width="16"/g)).toHaveLength(4);
      expect(markup.match(/height="16"/g)).toHaveLength(4);
      expect(markup).toContain(`bar-face ${direction}`);
    });
  }

  it("measures the same icon and label slots without animated buttons", () => {
    const markup = renderToStaticMarkup(<BarFace hovered={null} direction="right" measuring />);
    expect(markup.match(/class="action-title"/g)).toHaveLength(4);
    expect(markup.match(/width="16"/g)).toHaveLength(4);
    expect(markup).not.toContain("hover-pill");
    expect(markup).not.toContain("data-projection-id");
  });

  it("initializes animated SVGs in their resting pose on their first render", () => {
    const search = renderToStaticMarkup(<SearchIcon size={16} />);
    const copy = renderToStaticMarkup(<CopyIcon size={16} />);
    const languages = renderToStaticMarkup(<LanguagesIcon size={16} />);
    expect(search).toContain('style="transform:none"');
    expect(copy.match(/style="transform:none;/g)).toHaveLength(2);
    expect(languages.match(/pathLength="1"/g)).toHaveLength(6);
  });
});
