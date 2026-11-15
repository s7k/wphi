// 利用者ガイドの画像を撮る。使い方は tools/guide/README.md
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "guide-images";
mkdirSync(out, { recursive: true });
const chrome =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: chrome });
// UA に Windows を入れると、画像を http://phi-asset.localhost から読む(ui/src/asset.ts)。そこを guide_server へ回す
const page = await browser.newPage({
  viewport: { width: 1000, height: 640 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0) WPHI-guide",
});
page.on("pageerror", (e) => console.error("pageerror", e.stack));
await page.route("http://phi-asset.localhost/**", (r) =>
  r.continue({ url: r.request().url().replace("http://phi-asset.localhost/", "http://127.0.0.1:5180/asset/") }),
);
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });
const button = (name) => page.getByRole("button", { name, exact: true });

await page.goto("http://localhost:5179/");
await button("接続").first().waitFor();
await shot("characters");

// 接続すると、架空のサーバの行を流す(guide_server の /events)
await button("接続").first().click();
await page.waitForFunction(() => window.guideReady === true, null, { timeout: 30000 });
await page.waitForTimeout(800);
await shot("priv");
await page.locator(".priv-head button").click();
await page.waitForTimeout(300);
await shot("main");

// ログの検索
await page.locator(".phi-log").focus();
await page.keyboard.press("Control+f");
await page.keyboard.type("Kotone");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await shot("find");
await page.keyboard.press("Escape");

// 看板のエディタ(S)
await page.locator(".phi-log").focus();
await page.keyboard.press("s");
const board = page.locator(".board-body textarea");
await board.waitFor();
await board.fill("/*color=#2080d0*/ようこそ/*.*/ お城の入口です\n/*size=large*/北の池/*.*/ では釣りが出来ます");
await page.waitForTimeout(500);
await shot("board");
await button("キャンセル").click();

// キャラグラとマップチップの取得
await page.evaluate(() => window.menu("download"));
await page.waitForTimeout(300);
await shot("download");
await button("閉じる").click();

// 地図の演出。行を流し、アニメーションを途中で止めて地図の周りを撮る。演出が消えるのを待ってから次へ
for (const [scene, at] of [
  ["talk", 0],
  ["slash", 60],
  ["bolt", 180],
  ["heal", 250],
  ["status", 250],
  ["dead", 200],
  ["buff", 450],
  ["debuff", 300],
]) {
  await page.evaluate((s) => window.guideEffect(s), scene);
  await page.waitForTimeout(100);
  await page.evaluate((t) => document.getAnimations().forEach((a) => ((a.currentTime = t), a.pause())), at);
  await shot(`effect-${scene}`, { clip: { x: 110, y: 160, width: 300, height: 170 } });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await page.waitForTimeout(4500);
}

// 設定
await button("設定").click();
await page.waitForTimeout(300);
await shot("settings");

await browser.close();
