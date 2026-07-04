export type FileBrowserDensity = "comfortable" | "compact";

export const FILE_BROWSER_THEME_CONTRACT = {
  accent: "var(--color-primary-500, oklch(.54 .19 285))",
  accentSoft: "var(--color-primary-50, oklch(.54 .19 285 / .09))",
  bg: "var(--color-gray-50, #f5f5f9)",
  surface: "var(--color-white, #fff)",
  surface2: "var(--color-gray-100, #f1f1f6)",
  border: "var(--color-gray-200, #e5e5ee)",
  borderStrong: "var(--color-gray-300, #d3d3e2)",
  text: "var(--color-gray-950, #1a1a24)",
  muted: "var(--color-gray-500, #71717f)",
  ok: "var(--color-green-600, oklch(.54 .15 150))",
  okSoft: "var(--color-green-50, oklch(.54 .15 150 / .12))",
  warn: "var(--color-yellow-600, oklch(.54 .15 80))",
  warnSoft: "var(--color-yellow-50, oklch(.54 .15 80 / .12))",
  danger: "var(--color-red-600, oklch(.54 .19 25))",
  dangerSoft: "var(--color-red-50, oklch(.54 .19 25 / .1))",
  folder: "var(--color-amber-300, oklch(.78 .12 80))",
  radius: "var(--radius-lg, 10px)",
  gap: "var(--spacing, .25rem)",
} as const;

export function getFileBrowserDensityAttributes(
  density: FileBrowserDensity = "comfortable",
): { "data-fb-density": FileBrowserDensity } {
  return { "data-fb-density": density };
}
