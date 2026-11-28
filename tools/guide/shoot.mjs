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
// vite のページ。別のポートで立てた時は GUIDE_URL で変える
const base = process.env.GUIDE_URL ?? "http://localhost:5179";

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
  await page.goto(`${base}/${query}`);
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
// カバンの足元の欄。「足元を見る」で #ex-inv floor を送り、足元の物の行を流す
await button("足元を見る").click();
await page.evaluate(() => window.guideEffect("fx-floor"));
await page.waitForTimeout(300);
await shot("bag-floor");
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
// 依頼の欄。右上の仲間の一覧の下に出る
await page.evaluate(() => window.guideEffect("fx-quest"));
await page.waitForTimeout(300);
await shot("quest");
await page.evaluate(() => window.guideEffect("quest-end"));
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
// 視界の外の仲間。地図の端に矢印を出す
await page.evaluate(() => window.guideEffect("fx-party-far"));
await page.waitForTimeout(400);
await shot("party-far");
await page.evaluate(() => window.guideEffect("party-end"));
await page.waitForTimeout(300);
// GM が置いた目印。視界の外の宿屋は端の矢印、視界の中の井戸は旗
await page.evaluate(() => window.guideEffect("fx-marks"));
await page.waitForTimeout(400);
await shot("marks");
await page.evaluate(() => window.guideEffect("marks-end"));
await page.evaluate(() => window.guideEffect("party-end"));
await page.waitForTimeout(300);

// NPC との会話の窓と、店の窓
await page.evaluate(() => window.guideEffect("fx-talk"));
await page.waitForTimeout(300);
await shot("talk");
await page.locator(".phi-log").focus();
await page.keyboard.press("Escape");
await page.evaluate(() => window.guideEffect("fx-shop"));
await page.waitForTimeout(300);
await shot("shop");
await page.locator(".phi-log").focus();
await page.keyboard.press("Escape");
// 取引の窓
await page.evaluate(() => window.guideEffect("fx-trade"));
await page.waitForTimeout(300);
await shot("trade");
await page.evaluate(() => window.guideEffect("trade-end"));
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
// 書きかけがあるので、捨てて閉じるか確かめる窓が出る
await button("はい").click();

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
  ["slash", 120],
  ["bolt", 180],
  ["heal", 250],
  ["status", 250],
  ["dead", 200],
  ["buff", 450],
  ["debuff", 300],
  ["fx-explode", 350],
  ["fx-swirl", 400],
  ["fx-skill", 300],
]) {
  await page.evaluate((s) => window.guideEffect(s), scene);
  await page.waitForTimeout(100);
  await page.evaluate((t) => document.getAnimations().forEach((a) => ((a.currentTime = t), a.pause())), at);
  await shot(`effect-${scene.replace("fx-", "")}`, { clip });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
  await page.waitForTimeout(4500);
}
// 対象 (Shift+G で一番近い猫) と HP バー、詠唱バー、足元の魔法陣と攻撃の待ちの輪
await page.locator(".phi-log").focus();
await page.keyboard.press("Shift+G");
await page.evaluate(() => window.guideEffect("fx-hpbar"));
await page.evaluate(() => window.guideEffect("fx-chant"));
await page.waitForTimeout(100);
await page.evaluate(() => document.getAnimations().forEach((a) => ((a.currentTime = 400), a.pause())));
await shot("target", { clip });
await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
await page.keyboard.press("Escape");
await page.evaluate(() =>
  document.querySelectorAll(".log-area, .modern-hud, .bag-button").forEach((e) => (e.style.visibility = "")),
);

// ログの絞り込み。演出で流した戦闘の行だけを出す
await button("戦闘").click();
await page.waitForTimeout(300);
// 絞り込みのボタンはログの枠の上にはみ出すので、上へ広げて切り抜く
const log = await page.locator(".log-area").boundingBox();
await shot("log-filter", { clip: { x: log.x, y: log.y - 16, width: log.width, height: log.height + 16 } });
await button("全部").click();

// 魔法の列。上の段の左端の自動攻撃のボタンを押すと、近い猫を対象にして始め、ボタンが赤くなる。ログに行が残るので最後の方で撮る。
// 技を 1 つ出した直後の待ちを流し、使った技の長い扇形と、他の技の共通の待ちの扇形を見せる
await page.locator(".spell-tile.auto-attack").click();
await page.evaluate(() => window.guideEffect("fx-skill-wait"));
await page.waitForTimeout(1400);
const bar = await page.locator(".spell-bar").boundingBox();
await shot("auto-attack", { clip: { x: bar.x - 48, y: bar.y - 40, width: bar.width + 56, height: bar.height + 48 } });
await page.locator(".spell-tile.auto-attack").click();
await page.locator(".phi-log").focus();
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// 設定
await button("設定").click();
await page.waitForTimeout(300);
await shot("settings");
await page.locator("fieldset.settings-group", { hasText: "戦闘" }).screenshot({ path: `${out}/settings-combat.png` });

// クラシック(1窓)。窓の形の説明に使う
const classic = await open("");
await classic.getByRole("button", { name: "接続", exact: true }).first().click();
await classic.waitForFunction(() => window.guideReady === true, null, { timeout: 30000 });
await classic.locator(".priv-window-head button[title^='閉じる']").click();
await classic.waitForTimeout(500);
await shotOf(classic)("classic");

await browser.close();
