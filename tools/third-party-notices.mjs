#!/usr/bin/env node
// 配布物に同梱する依存ライブラリの著作権表示とライセンス文(src-tauri/THIRD-PARTY-NOTICES.txt)を作る。
//
//   node tools/third-party-notices.mjs          書き直す
//   node tools/third-party-notices.mjs --check  今の依存と合っているかだけを見る(合わなければ 1 で終わる)
//
// ネットワークに出ずに作れるよう、ライセンス文は手元にある物から読む。
// - Rust: cargo metadata の、wphi から通常の依存(build と dev の依存は除く)で辿れるクレート。
//   全部の OS の依存を入れる(配布物ごとに分けない)。文は ~/.cargo/registry/src に展開したクレートの LICENSE* など
// - npm: package.json の dependencies から dependencies で辿れるパッケージ(画面に同梱する物)。文は node_modules の LICENSE など
// 先に npm ci と cargo fetch を済ませておく。
// 同じ文を使うパッケージはまとめて 1 回だけ書く(Apache-2.0 の全文を何百回も並べない為)。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "src-tauri", "THIRD-PARTY-NOTICES.txt");

/** パッケージのフォルダにあるライセンスの文書。無ければ空 */
function licenseFiles(dir, extra) {
  const names = fs
    .readdirSync(dir)
    .filter((f) => /^(licen[cs]e|copying|notice|copyright)/i.test(f) && fs.statSync(path.join(dir, f)).isFile());
  if (extra && fs.existsSync(path.join(dir, extra)) && !names.includes(path.basename(extra))) names.push(extra);
  return names.sort().map((f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n").trim());
}

function cargoPackages() {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", path.join(root, "Cargo.toml")], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const start = meta.packages.find((p) => p.name === "wphi" && p.source == null).id;
  const seen = new Set([start]);
  const todo = [start];
  while (todo.length) {
    for (const d of nodes.get(todo.pop()).deps) {
      // kind が null の物が通常の依存
      if (!d.dep_kinds.some((k) => k.kind == null) || seen.has(d.pkg)) continue;
      seen.add(d.pkg);
      todo.push(d.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    // このリポジトリのクレート(source が無い物)は WPHI 自身
    .filter((p) => p.source != null)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? "",
      authors: p.authors ?? [],
      texts: licenseFiles(path.dirname(p.manifest_path), p.license_file),
    }));
}

/** `from` から上へ node_modules/<name> を探す(npm の解決と同じ順) */
function findPackage(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const p = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(p, "package.json"))) return p;
    if (path.dirname(dir) === dir) throw new Error(`node_modules に ${name} が無い。先に npm ci を済ませる`);
  }
}

function npmPackages() {
  const top = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const found = new Map();
  const todo = Object.keys(top.dependencies ?? {}).map((name) => [name, root]);
  while (todo.length) {
    const [name, from] = todo.pop();
    const dir = findPackage(name, from);
    if (found.has(dir)) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    found.set(dir, {
      name: pkg.name,
      version: pkg.version,
      license: typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? ""),
      authors: author ? [author] : [],
      texts: licenseFiles(dir),
    });
    for (const d of Object.keys(pkg.dependencies ?? {})) todo.push([d, dir]);
  }
  return [...found.values()];
}

/** ライセンスの文書を持たないパッケージに添える、SPDX ごとの全文の見分け方。上にある物ほど先に選ぶ */
const TEMPLATES = [
  ["MIT", "Permission is hereby granted, free of charge"],
  ["Apache-2.0", "Version 2.0, January 2004"],
  ["BSD-3-Clause", "Neither the name"],
  ["Zlib", "This software is provided 'as-is'"],
  ["MPL-2.0", "Mozilla Public License Version 2.0"],
];

function render(packages) {
  const key = (p) => `${p.name}@${p.version}`;
  packages.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  // 文書ごとに、それを使うパッケージをまとめる。MIT と Apache-2.0 の両方を持つ物は両方に載る
  const groups = new Map();
  const missing = [];
  for (const p of packages) {
    if (p.texts.length === 0) missing.push(p);
    for (const text of new Set(p.texts)) {
      if (!groups.has(text)) groups.set(text, []);
      groups.get(text).push(p);
    }
  }
  // 文書が無い物には、記載の SPDX の全文を他のパッケージの文書から借りて添える。
  // 著作権の行は借りた先の物なので消し、作者の欄を著作権者として読む
  // 全文だけの物を選ぶよう、短い順に探す
  const allTexts = [...groups.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const borrowed = new Map();
  for (const p of missing) {
    const ids = p.license.split(/\s+OR\s+|\//).map((s) => s.trim());
    const [id, mark] = TEMPLATES.find(([id]) => ids.includes(id)) ?? [];
    if (!id) throw new Error(`${key(p)} のライセンス ${p.license} の全文が無い`);
    const text = allTexts.find((t) => t.includes(mark));
    if (!text) throw new Error(`${id} の全文が他のパッケージにも無い`);
    if (!borrowed.has(id)) {
      const body = text.replace(/^.*copyright \(c\).*$\n?/gim, "").trim();
      borrowed.set(id, { body, packages: [] });
    }
    borrowed.get(id).packages.push(p);
  }
  const line = "=".repeat(78);
  const head = (p) =>
    `${p.name} ${p.version} (${p.license || "ライセンスの記載なし"})` +
    (p.authors.length ? `\n  ${p.authors.join(", ")}` : "");
  let s =
    "WPHI が同梱する第三者のソフトウェアと、その著作権表示およびライセンス文。\n" +
    "tools/third-party-notices.mjs で作った。手で直さない。\n";
  for (const [text, ps] of groups) {
    s += `\n${line}\n${ps.map(head).join("\n")}\n${line}\n\n${text}\n`;
  }
  for (const [id, { body, packages: ps }] of [...borrowed].sort()) {
    s +=
      `\n${line}\n${ps.map(head).join("\n")}\n${line}\n\n` +
      `パッケージにライセンスの文書が無いので、記載の ${id} の全文を添える。著作権者は上の作者。\n\n${body}\n`;
  }
  return s;
}

const text = render([...cargoPackages(), ...npmPackages()]);
if (process.argv.includes("--check")) {
  // Windows の checkout は改行を CRLF にする事があるので、改行を揃えて比べる
  const now = fs.existsSync(out) ? fs.readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== text) {
    console.error(`${path.relative(root, out)} が今の依存と合わない。node tools/third-party-notices.mjs で作り直す`);
    process.exit(1);
  }
} else {
  fs.writeFileSync(out, text);
  console.log(out);
}
