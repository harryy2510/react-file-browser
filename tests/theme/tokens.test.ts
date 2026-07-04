import { describe, expect, test } from "vitest";
import {
  FILE_BROWSER_THEME_CONTRACT,
  getFileBrowserDensityAttributes,
} from "@/theme";

describe("theme token contract", () => {
  test("maps public file-browser variables to host Tailwind token fallbacks", () => {
    expect(FILE_BROWSER_THEME_CONTRACT.accent).toBe(
      "var(--color-primary-500, oklch(.54 .19 285))",
    );
    expect(FILE_BROWSER_THEME_CONTRACT.surface).toBe(
      "var(--color-white, #fff)",
    );
    expect(FILE_BROWSER_THEME_CONTRACT.border).toBe(
      "var(--color-gray-200, #e5e5ee)",
    );
    expect(FILE_BROWSER_THEME_CONTRACT.radius).toBe(
      "var(--radius-lg, 10px)",
    );
    expect(FILE_BROWSER_THEME_CONTRACT.gap).toBe("var(--spacing, .25rem)");
  });

  test("uses a data attribute for density without creating style state", () => {
    expect(getFileBrowserDensityAttributes("compact")).toEqual({
      "data-fb-density": "compact",
    });
    expect(getFileBrowserDensityAttributes()).toEqual({
      "data-fb-density": "comfortable",
    });
  });
});
