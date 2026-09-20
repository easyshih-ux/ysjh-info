import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import manifest from "../app/manifest.ts";

const rootFile = (path: string) => new URL(`../${path}`, import.meta.url);
const source = (path: string) => readFileSync(rootFile(path), "utf8");

function pngDimensions(path: string) {
  const image = readFileSync(rootFile(path));
  assert.equal(image.toString("ascii", 1, 4), "PNG");
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

test("PWA manifest 使用正式網站資訊與 GitHub Pages scope", () => {
  const value = manifest();
  assert.match(source("app/manifest.ts"), /export const dynamic = "force-static"/);
  assert.equal(value.name, "義學公務資訊站");
  assert.equal(value.short_name, "義學公務");
  assert.equal(value.description, "義學國中校務與公務資訊整合平台");
  assert.equal(value.start_url, "/ysjh-info/");
  assert.equal(value.scope, "/ysjh-info/");
  assert.equal(value.display, "standalone");
  assert.equal(value.theme_color, "#173B63");
  assert.equal(value.background_color, "#F3F5F7");
  assert.equal("orientation" in value, false);
});

test("manifest 一般與 maskable icons 全部使用 Project Pages 路徑", () => {
  const icons = manifest().icons ?? [];
  assert.equal(icons.length, 4);
  assert.ok(icons.every(icon => icon.src.startsWith("/ysjh-info/icons/")));
  assert.deepEqual(icons.filter(icon => icon.purpose === "any").map(icon => icon.sizes), ["192x192", "512x512"]);
  assert.deepEqual(icons.filter(icon => icon.purpose === "maskable").map(icon => icon.sizes), ["192x192", "512x512"]);
});

test("PWA PNG 與 favicon 檔案存在且尺寸正確", () => {
  const expected = [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/icon-maskable-192.png", 192],
    ["public/icons/icon-maskable-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
  ] as const;

  for (const [path, size] of expected) {
    assert.equal(existsSync(rootFile(path)), true, `${path} 應存在`);
    assert.deepEqual(pngDimensions(path), { width: size, height: size });
  }
  assert.equal(existsSync(rootFile("public/favicon.ico")), true);
});

test("layout metadata 指向 manifest、favicon、Apple icon 與 viewport theme color", () => {
  const layout = source("app/layout.tsx");
  assert.match(layout, /manifest:\s*"\/ysjh-info\/manifest\.webmanifest"/);
  assert.match(layout, /icon:\s*"\/ysjh-info\/favicon\.ico"/);
  assert.match(layout, /apple:\s*"\/ysjh-info\/icons\/apple-touch-icon\.png"/);
  assert.match(layout, /appleWebApp:\s*\{/);
  assert.match(layout, /export const viewport: Viewport/);
  assert.match(layout, /themeColor:\s*"#173B63"/);
});
