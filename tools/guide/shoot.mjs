// 利用者ガイドの画像を撮る。使い方は tools/guide/README.md
// ガイドは v6 のサーバでモダンの画面を使う前提なので、モダンで撮る。窓の形の説明に使う classic.png だけをクラシック(1窓)で撮る
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "guide-images";
mkdirSync(out, { recursive: true });
const chrome =
  process.env.CHROME ??
  `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: chrome });

/** 新しいページで WPHI を開く。query は shot.tsx の切り替え(?modern など) */
async function open(query) {
  // UA に Windows を入れると、画像を http://phi-asset.localhost から読む(ui/src/asset.ts)。そこを guide_server へ回す
  const page = await browser.newPage({
    viewport: { width: 1000, height: 640 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0) WPHI-guide",
  });
  page.on("pageerror", (e) => console.error("pageerror", e.stack));
  await page.route("http://phi-asset.localhost/**", (r) =>
    r.continue({ url: r.request().url().replace("http://phi-asset.localhost/", "http://127.0.0.1:5180/asset/") }),
  );
  await page.goto(`http://localhost:5179/${query}`);
  return page;
}
const shotOf = (page) => (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });

const page = await open("?modern");
const shot = shotOf(page);
const button = (name) => page.getByRole("button", { name, exact: true });
await button("接続").first().waitFor();
await shot("characters");

// 接続すると、架空のサーバの行を流す(guide_server の /events)
await button("接続").first().click();
await page.waitForFunction(() => window.guideReady === true, null, { timeout: 30000 });
await page.waitForTimeout(800);
await shot("priv");
await page.locator(".priv-window-head button[title^='閉じる']").click();
await page.waitForTimeout(300);
// 持ち物の行を流し、右上にカバンのボタンを出してから全体を撮る
await page.evaluate(() => window.guideEffect("bag"));
await page.waitForTimeout(400);
await shot("main");

// カバン。開くとインベントリの中身を求めるので、もう一度行を流し、手持ちの剣を選ぶ
await page.locator("button[title^=\"カバン\"]").click();
await page.evaluate(() => window.guideEffect("bag"));
await page.waitForTimeout(300);
await page.locator(".bag-tile").nth(0).click();
await page.waitForTimeout(200);
await shot("bag");
await page.keyboard.press("Escape");
await page.locator(".phi-log").focus();
await page.keyboard.press("Escape");

// パーティ。隣の Kotone を左クリックして誘うメニューを出し、その後に仲間の一覧の行を流す
await page.evaluate(() => window.guideEffect("near"));
await page.waitForTimeout(400);
const near = await page.locator(".map-area canvas").boundingBox();
await page.mouse.click(near.x + near.width / 2 + 32, near.y + near.height / 2 - 4);
await page.waitForTimeout(300);
await shot("party-menu");
await page.keyboard.press("Escape");
await page.evaluate(() => window.guideEffect("back"));
await page.evaluate(() => window.guideEffect("party"));
await page.waitForTimeout(400);
await shot("party-hud");
// 入力欄の上のパーティのタブ
await page.getByRole("tab", { name: "パーティ" }).click();
await page.waitForTimeout(300);
await shot("party-chat");
await page.getByRole("tab", { name: "全体" }).click();
await page.locator(".party-hud").click();
await page.waitForTimeout(300);
await shot("party");
await page.keyboard.press("Escape");
await page.evaluate(() => window.guideEffect("party-end"));
await page.waitForTimeout(300);

// 看板を読んだ時の札
await page.evaluate(() => window.guideEffect("sign"));
await page.waitForTimeout(400);
await shot("sign");
await page.locator(".phi-log").focus();
await page.keyboard.press("Escape");

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

// 地図の演出。行を流し、アニメーションを途中で止めて地図の周りを撮る。演出が消えるのを待ってから次へ。
// ログと地名・HP・MP は地図に重なるので隠す
await page.evaluate(() =>
  document.querySelectorAll(".log-area, .modern-hud, .bag-button").forEach((e) => (e.style.visibility = "hidden")),
);
// 自分は地図の真ん中にいる。Kotone が3マス東にいるので、右へ寄せて切り抜く
const map = await page.locator("canvas").first().boundingBox();
const clip = { x: Math.round(map.x + map.width / 2 - 105), y: Math.round(map.y + map.height / 2 - 85), width: 300, height: 170 };
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
  await shot(`effect-${scene}`, { clip });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await page.waitForTimeout(4500);
}
await page.evaluate(() =>
  document.querySelectorAll(".log-area, .modern-hud, .bag-button").forEach((e) => (e.style.visibility = "")),
);

// 設定
await button("設定").click();
await page.waitForTimeout(300);
await shot("settings");

// クラシック(1窓)。窓の形の説明に使う
const classic = await open("");
await classic.getByRole("button", { name: "接続", exact: true }).first().click();
await classic.waitForFunction(() => window.guideReady === true, null, { timeout: 30000 });
await classic.locator(".priv-window-head button[title^='閉じる']").click();
await classic.waitForTimeout(500);
await shotOf(classic)("classic");

await browser.close();
