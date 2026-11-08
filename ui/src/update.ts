// 新しい版の知らせ(#25)。起動した時に GitHub Releases の最新の版を見て、新しければ Release のページを開くか聞く。
// 自動で置き換えはしない。Tauri の自動更新は、Windows ではインストーラで入れた物しか置き換えられず、
// zip を展開した WPHI.exe を別の場所へ入れ直してしまう為。

const LATEST = "https://api.github.com/repos/s7k/wphi/releases/latest";

/** "v0.1.30" と "0.1.29" を比べ、latest の方が新しければ true。数でない版は比べない */
export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const a = parse(latest);
  const b = parse(current);
  if ([...a, ...b].some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** 新しい版があれば、その版と Release のページの URL。無いか、見られなければ null */
export async function latestRelease(current: string): Promise<{ version: string; url: string } | null> {
  const res = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  const r: { tag_name?: string; html_url?: string } = await res.json();
  if (!r.tag_name || !r.html_url?.startsWith("https://github.com/s7k/wphi/")) return null;
  return isNewer(r.tag_name, current) ? { version: r.tag_name.replace(/^v/, ""), url: r.html_url } : null;
}
