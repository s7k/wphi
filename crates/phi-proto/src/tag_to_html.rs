//! PHI のタグ(`/*color=red*/〜/*.*/` など)を含むログの1行を、ログ欄に入れる HTML にする。
//!
//! 移植元は Philly の `TagToHtml.cpp`(`ToHtml` と `ChangeNameFont`)。
//! 時刻の付与(`AddTime`)は UI 側で行う。
//!
//! サーバから届いた文字列を HTML として WebView に入れるので、最初に必ずエスケープする。
//! Philly との違いは2点で、どちらも他のプレイヤーの発言から CSS や URL を差し込ませない為である。
//! - `color=` と `font=` の値に使える文字を絞る
//! - `/*img=...*/` の画像は `http://` と `https://` だけを許す
//! - LAN や自分の機械を指す画像は出さない。受けた人の環境から LAN の機器へ GET を出させない為(#55)

use fancy_regex::{Captures, Regex, Replacer};
use std::borrow::Cow;
use std::sync::LazyLock;

/// 置き換え。backtrack の上限を超えたら置き換えずに返す。
/// fancy-regex の `replace` 系は上限を超えると panic し、受信のタスクごと落ちる。
/// 看板の本文などで、読んだ人の接続を黙って切らせない為(#48)
trait TryReplace {
    fn sub_all<'t, R: Replacer>(&self, t: &'t str, rep: R) -> Cow<'t, str>;
    fn sub1<'t, R: Replacer>(&self, t: &'t str, rep: R) -> Cow<'t, str>;
}

impl TryReplace for Regex {
    fn sub_all<'t, R: Replacer>(&self, t: &'t str, rep: R) -> Cow<'t, str> {
        self.try_replacen(t, 0, rep).unwrap_or(Cow::Borrowed(t))
    }
    fn sub1<'t, R: Replacer>(&self, t: &'t str, rep: R) -> Cow<'t, str> {
        self.try_replacen(t, 1, rep).unwrap_or(Cow::Borrowed(t))
    }
}

/// ログ表示の設定。既定値は Philly の `Config.cpp` と同じ。
#[derive(Debug, Clone)]
pub struct LogOptions {
    /// URL にリンクを張る(LogUrlLink)。
    pub url_link: bool,
    /// `/*img=...*/` の画像を表示する(LogImageDisp)。
    pub image_disp: bool,
    /// 画像の URL を発言しただけでも表示する(LogImageDispURL)。
    pub image_disp_url: bool,
    /// URL の画像を表示した時に URL も表示する(LogImageLinkDisp)。
    pub image_link_disp: bool,
    /// 大声でも画像を表示する(LogImageDispLoud)。
    pub image_disp_loud: bool,
    /// 大声でも大きな文字を表示する(LogLargeDispLoud)。
    pub large_disp_loud: bool,
    /// 解釈出来ないタグをそのまま表示する(NotInterpretedTagDisp)。
    pub not_interpreted_tag_disp: bool,
    /// タブ幅(TabWidth)。
    pub tab_width: usize,
}

impl Default for LogOptions {
    fn default() -> Self {
        Self {
            url_link: true,
            image_disp: true,
            image_disp_url: true,
            image_link_disp: true,
            image_disp_loud: true,
            large_disp_loud: false,
            not_interpreted_tag_disp: false,
            tab_width: 8,
        }
    }
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("正規表現が不正")
}

macro_rules! regex {
    ($name:ident, $pattern:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| re($pattern));
    };
}

regex!(BR_TAG, r"(?i)/\*br\*/");
regex!(
    FONT_TAG,
    r"(?i)/\*(\.|[a-zA-Z]|(color|cl|c|size|font|ft|style)=(.+?))\*/"
);
regex!(CLASS_KEY, r"(?i)(color|cl|c|size|font|ft|style)=");
regex!(CLASS_SIZE_PLUS, r"(?i)size_\+");
regex!(CLASS_HPMP, r"(?i)(color|cl|c)_\+(hp|mp)");
regex!(CLASS_777, r"(?i)(color|cl|c)_#777");
regex!(CLASS_LOUD_SIZE, r"(?i)size_(_\d|\d|large)");
regex!(STYLE_COLOR, r"(?i)(?:color|cl|c)=([^ ]+)");
regex!(
    STYLE_COLOR_CLASS_ONLY,
    r"(?i)(?:\+hp|\-hp|\+mp|\-mp|\#777|white|cyan|yellow)"
);
regex!(STYLE_FONT, r"(?i)(?:font|ft)=([^=]+?)(?: +[^ ]+=| *$)");
regex!(IMG_WND, r"(?i)/\*(img_wnd=.*?)\*/");
regex!(IMG_TAG, r"(?i)/\*(img=.+?)\*/");
regex!(
    IMG_URL,
    r"(?i)(s?https?://[-_.!~*'()a-zA-Z0-9;/?:\@&=+\$,%#]+\.(?:gif|jpg|jpeg|png|bmp))"
);
regex!(URL, r"(s?https?://[-_.!~*'()a-zA-Z0-9;/?:\@&=+\$,%#]+)");
regex!(EMPTY_TAG, r"/\*\*/");
regex!(TO_TAG, r"/\*(to=.*?)\*/");
regex!(ANY_TAG, r"/\*(.*?)\*/");
regex!(NEWLINE, r"\r?\n");
regex!(SPACE_AROUND_TAG, r"( <[^>]*?>) ");
regex!(HTML_TAG, r"<.*?>");
regex!(NAME_TEST, r"^(\[?[^&]{1,31}?\]?) &gt;");
regex!(NAME, r"(\[?(?:(?!&gt;)[^>])+?\]?) &gt;");

/// 1行を HTML にする(Philly の `ToHtml` に続けて `ChangeNameFont` を呼んだ結果)。
pub fn to_html(text: &str, opts: &LogOptions) -> String {
    let loud = text.starts_with('(');
    let mut t = escape_html(text);

    t = t.replace("はーと", "&hearts;");
    t = t.replace(
        "もなりざ",
        r#"<font style="font-family:webdings;font-size:500%;line-height:100%">&#0159;</font>"#,
    );
    t = BR_TAG.sub_all(&t, r#"<br class="phi_tag">"#).into_owned();
    t = font_tags(&t, loud, opts);

    if IMG_WND.is_match(&t).unwrap_or(false) {
        t = IMG_WND.sub_all(&t, "<!--$1-->").into_owned();
    } else if let Some(with_images) = image_tags(&t, loud, opts) {
        t = with_images;
    } else if opts.url_link {
        t = outside_tags(&t, |s| URL.sub_all(s, r#"<a href="$1">$1</a>"#).into_owned());
    }

    t = EMPTY_TAG.sub_all(&t, "<!---->").into_owned();
    t = TO_TAG.sub_all(&t, "<!--$1-->").into_owned();
    if !opts.not_interpreted_tag_disp {
        t = ANY_TAG.sub_all(&t, "<!--$1-->").into_owned();
    }
    t = NEWLINE.sub_all(&t, "<br />").into_owned();

    // 発言("名前 &gt; 本文")の本文だけタブを空白にする
    if let Some((head, body)) = t.split_once("&gt; ") {
        t = format!("{head}&gt; {}", expand_tabs(body, opts.tab_width));
    }
    // 半角スペース2つは全角スペースにする(&nbsp; より幅を取らない)
    t = t.replace("  ", "　");
    if let Some(rest) = t.strip_prefix(' ') {
        t = format!("&nbsp;{rest}");
    }
    t = SPACE_AROUND_TAG.sub_all(&t, "$1&nbsp;").into_owned();

    change_name_font(&t)
}

/// HTML の特別な文字(`& < > " '`)を全部エスケープする。
pub fn escape_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

/// `/*.*/` は開いているタグを全部閉じ、`/*color=.*/` のように値が `.` なら1つ閉じる。
fn font_tags(text: &str, loud: bool, opts: &LogOptions) -> String {
    let mut t = text.to_string();
    let mut open = 0usize;
    let mut pos = 0;
    while let Ok(Some(caps)) = FONT_TAG.captures_from_pos(&t, pos) {
        let whole = caps.get(0).unwrap();
        let this = caps.get(1).unwrap().as_str();
        let replace = if this == "." {
            let mut s = "</font>".to_string();
            for _ in 1..open {
                s.push_str("</font><!--font_none-->");
            }
            open = 0;
            s
        } else if this.chars().count() == 1 {
            open += 1;
            format!(r#"<font class="color_{this}_">"#)
        } else if caps.get(3).map(|m| m.as_str()) == Some(".") {
            open = open.saturating_sub(1);
            format!("</font><!--{}-->", &caps[2])
        } else {
            open += 1;
            font_open_tag(this, loud, opts)
        };
        let start = whole.start();
        t.replace_range(whole.range(), &replace);
        pos = start + replace.len();
    }
    for _ in 0..open {
        t.push_str("</font><!--font_none-->");
    }
    t
}

fn font_open_tag(this: &str, loud: bool, opts: &LogOptions) -> String {
    let mut class = CLASS_KEY.sub_all(this, "${1}_").into_owned();
    class = CLASS_SIZE_PLUS.sub_all(&class, "size__").into_owned();
    class = CLASS_HPMP.sub_all(&class, "${1}__$2").into_owned();
    class = CLASS_777.sub_all(&class, "${1}_777").into_owned();
    if loud && !opts.large_disp_loud {
        // 大声では大きな文字を無効にする
        class = CLASS_LOUD_SIZE.sub_all(&class, "size_${1}_").into_owned();
    }

    let mut style = String::new();
    if let Ok(Some(c)) = STYLE_COLOR.captures(this) {
        let color = &c[1];
        let class_only = STYLE_COLOR_CLASS_ONLY.is_match(color).unwrap_or(false);
        if !class_only && color.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '#') {
            style.push_str(&format!("color:{color};"));
        }
    }
    if let Ok(Some(c)) = STYLE_FONT.captures(this) {
        let font = &c[1];
        if !font.contains([';', ':', '(', ')', '{', '}', '\\', '/']) {
            style.push_str(&format!("font-family:{font};"));
        }
    }
    let mut tag = format!(r#"<font class="{class}""#);
    if !style.is_empty() {
        tag.push_str(&format!(r#" style="{style}""#));
    }
    tag.push('>');
    tag
}

/// 画像を1つでも入れたら `Some` を返す。`None` なら呼び出し側が URL にリンクを張る。
fn image_tags(text: &str, loud: bool, opts: &LogOptions) -> Option<String> {
    if !opts.image_disp || (loud && !opts.image_disp_loud) {
        return None;
    }
    let mut t = text.to_string();
    let mut replaced = false;
    let mut pos = 0;
    while let Ok(Some(caps)) = IMG_TAG.captures_from_pos(&t, pos) {
        let whole = caps.get(0).unwrap();
        let replace = img_element(&caps);
        let start = whole.start();
        t.replace_range(whole.range(), &replace);
        pos = start + replace.len();
        replaced = true;
    }
    if replaced {
        return Some(t);
    }
    if !opts.image_disp_url {
        return None;
    }
    let mut last_url = None;
    let mut out = outside_tags(&t, |s| {
        IMG_URL
            .sub_all(s, |c: &Captures| {
                if is_local_url(&c[1]) {
                    return c[0].to_string();
                }
                last_url = Some(c[1].to_string());
                if opts.image_link_disp {
                    format!(r#"<div><img src="{}" align="top" />"#, &c[1])
                } else {
                    format!(r#"<img src="{}" align="top" />"#, &c[1])
                }
            })
            .into_owned()
    });
    let url = last_url?;
    if opts.image_link_disp {
        out.push_str(&format!(r#"<br /><a href="{url}">{url}</a></div>"#));
    }
    Some(out)
}

/// `f` をタグ(`<...>`)の外の文字列にだけ適用する。
///
/// 発言中の `<` はエスケープ済みなので、残っている `<` はこのモジュールが入れたタグの始まりである。
/// タグの属性値まで置換すると、URL に入れた `"` で属性を閉じて別の属性を差し込める。
fn outside_tags(html: &str, mut f: impl FnMut(&str) -> String) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(open) = rest.find('<') {
        out.push_str(&f(&rest[..open]));
        let close = rest[open..].find('>').map_or(rest.len(), |i| open + i + 1);
        out.push_str(&rest[open..close]);
        rest = &rest[close..];
    }
    out.push_str(&f(rest));
    out
}

/// `img=URL align=... width=... height=...` を `<img>` にする。http(s) 以外の URL は捨てる。
fn img_element(caps: &Captures) -> String {
    let value = |name: &str| {
        caps[1]
            .split(' ')
            .filter(|s| !s.is_empty())
            .find_map(|kv| {
                kv.split_once('=')
                    .filter(|(k, _)| *k == name)
                    .map(|(_, v)| v.to_string())
            })
            .filter(|v| !v.is_empty())
    };
    let Some(src) =
        value("img").filter(|s| (s.starts_with("http://") || s.starts_with("https://")) && !is_local_url(s))
    else {
        return String::new();
    };
    let mut tag = format!(r#"<img src="{src}""#);
    if let Some(align) = value("align") {
        tag.push_str(&format!(r#" align="{align}""#));
    }
    for name in ["width", "height"] {
        if let Some(v) = value(name) {
            let n = v.parse::<i64>().unwrap_or(0).clamp(0, 1000);
            tag.push_str(&format!(r#" {name}="{n}""#));
        }
    }
    tag.push_str(" />");
    tag
}

/// URL のホストが LAN か自分の機械か(localhost・プライベートアドレス・リンクローカルなど)。
/// ブラウザは `2130706433` や `0x7f.1` も 127.0.0.1 として読むので、16進の文字と数字と `.` だけのホストも LAN とみなす
/// (`ab12.de` のような名前も巻き込むが、画像が出ないだけで済む)。
// ponytail: 名前を引いて LAN のアドレスになるホスト(DNS rebinding)は防げない。防ぐなら WebView の要求を横取りして引いた先を見る
fn is_local_url(url: &str) -> bool {
    use std::net::{IpAddr, Ipv4Addr};
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#', '\\']).next().unwrap_or("");
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let host = match host_port.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host_port.split(':').next().unwrap_or(""),
    }
    .trim_end_matches('.')
    .to_ascii_lowercase();
    let v4 = |a: Ipv4Addr| {
        let [x, y, ..] = a.octets();
        a.is_private()
            || a.is_loopback()
            || a.is_link_local()
            || a.is_unspecified()
            || a.is_broadcast()
            || x == 0
            || (x == 100 && (64..128).contains(&y))
    };
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(a)) => v4(a),
        Ok(IpAddr::V6(a)) => {
            let s = a.segments()[0];
            a.is_loopback()
                || a.is_unspecified()
                || (s & 0xfe00) == 0xfc00
                || (s & 0xffc0) == 0xfe80
                || a.to_ipv4_mapped().is_some_and(v4)
        }
        Err(_) => {
            host.is_empty()
                || host == "localhost"
                || host.ends_with(".localhost")
                || host.ends_with(".local")
                || host.bytes().all(|b| b.is_ascii_hexdigit() || b == b'.' || b == b'x')
                    && host.bytes().any(|b| b.is_ascii_digit())
        }
    }
}

/// タブを空白にする。桁は Philly(cp932 のバイト数)に合わせ、ASCII を1、それ以外を2と数える。
fn expand_tabs(text: &str, width: usize) -> String {
    let width = width.max(1);
    let mut out = String::with_capacity(text.len());
    let mut col = 0;
    for ch in text.chars() {
        if ch == '\t' {
            let n = width - col % width;
            out.extend(std::iter::repeat_n(' ', n));
            col += n;
        } else {
            out.push(ch);
            col += if ch.is_ascii() { 1 } else { 2 };
        }
    }
    out
}

/// 発言者名に `class_name` を付ける(Philly の `ChangeNameFont`)。
fn change_name_font(html: &str) -> String {
    let plain = HTML_TAG.sub_all(html, "");
    if !NAME_TEST.is_match(&plain).unwrap_or(false) {
        return html.to_string();
    }
    NAME.sub1(html, r#"<font class="class_name">$1</font> &gt;"#)
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_gives_up_instead_of_panicking() {
        // backtrack の上限を小さくして、上限を超えさせる
        let re = fancy_regex::RegexBuilder::new(r"(a+)+(?=b)")
            .backtrack_limit(10)
            .build()
            .unwrap();
        let text = "a".repeat(30) + "c";
        assert!(re.try_replacen(&text, 0, "x").is_err());
        assert_eq!(re.sub_all(&text, "x"), text);
        assert_eq!(re.sub1(&text, "x"), text);
    }

    fn html(text: &str) -> String {
        to_html(text, &LogOptions::default())
    }

    #[test]
    fn escapes_before_tags() {
        assert_eq!(
            html(r#"<script>alert("x")</script>"#),
            "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
        );
        assert_eq!(
            html("<img src=x onerror=alert(1)>"),
            "&lt;img src=x onerror=alert(1)&gt;"
        );
    }

    #[test]
    fn font_tags_open_and_close() {
        assert_eq!(
            html("/*color=red*/赤/*.*/です"),
            r#"<font class="color_red" style="color:red;">赤</font>です"#
        );
        assert_eq!(
            html("/*r*/a/*b*/b/*.*/c"),
            r#"<font class="color_r_">a<font class="color_b_">b</font></font><!--font_none-->c"#
        );
        assert_eq!(html("/*cl=+hp*/x"), r#"<font class="cl__hp">x</font><!--font_none-->"#);
        // 大声では大きな文字を無効にする
        assert_eq!(
            html("(大声 /*size=3*/x/*size=.*/"),
            r#"(大声 <font class="size_3_">x</font><!--size-->"#
        );
    }

    #[test]
    fn rejects_css_and_url_injection() {
        // color の値に ; や ( を含む時は style を付けない
        assert_eq!(
            html("/*color=red;background:url(http://x)*/a/*.*/"),
            r#"<font class="color_red;background:url(http://x)">a</font>"#
        );
        // 属性値の中の URL にはリンクを張らない(張ると " で属性を閉じて onclick を差し込める)
        assert_eq!(
            html("/*color=http://x/onclick=alert(1)*/a/*.*/"),
            r#"<font class="color_http://x/onclick=alert(1)">a</font>"#
        );
        assert_eq!(html("/*img=javascript:alert(1)*/"), "");
        // LAN と自分の機械を指す画像は出さない(#55)
        for url in [
            "http://192.168.0.1/a.png",
            "http://10.1.2.3/a.png",
            "http://172.16.0.1/a.png",
            "http://127.0.0.1:8080/a.png",
            "http://localhost/a.png",
            "http://router.local/a.png",
            "http://[::1]/a.png",
            "http://[fe80::1]/a.png",
            "http://2130706433/a.png",
            "http://0x7f.1/a.png",
            "http://user@192.168.0.1/a.png",
        ] {
            assert_eq!(html(&format!("/*img={url}*/")), "", "{url}");
        }
        assert_eq!(
            html("/*img=http://e.test/a.png*/"),
            r#"<img src="http://e.test/a.png" />"#
        );
        assert_eq!(
            html("/*img=http://deadbeef.example/a.png*/"),
            r#"<img src="http://deadbeef.example/a.png" />"#
        );
        assert_eq!(
            html("/*img=https://e.test/a.png width=5000*/"),
            r#"<img src="https://e.test/a.png" width="1000" />"#
        );
    }

    #[test]
    fn links_and_images() {
        assert_eq!(
            html("see http://e.test/x"),
            r#"see <a href="http://e.test/x">http://e.test/x</a>"#
        );
        assert_eq!(
            html("http://e.test/a.png"),
            r#"<div><img src="http://e.test/a.png" align="top" /><br /><a href="http://e.test/a.png">http://e.test/a.png</a></div>"#
        );
        // LAN の画像の URL は画像にせず、リンクのまま
        assert!(!html("http://192.168.0.1/a.png").contains("<img"));
    }

    #[test]
    fn unknown_tags_and_spaces() {
        assert_eq!(
            html("a/**/b/*to=Bob*/c/*zzz=1*/"),
            "a<!---->b<!--to=Bob-->c<!--zzz=1-->"
        );
        assert_eq!(html(" a  b"), "&nbsp;a　b");
        assert_eq!(html("a/*br*/b"), r#"a<br class="phi_tag">b"#);
    }

    #[test]
    fn name_and_tabs() {
        assert_eq!(
            // タブで空いた7桁は、半角2つを全角1つにする置換で「全角3つ + 半角1つ」になる
            html("勇者 > a\tb"),
            "<font class=\"class_name\">勇者</font> &gt; a\u{3000}\u{3000}\u{3000} b"
        );
        assert_eq!(html("[Bob] > hi"), r#"<font class="class_name">[Bob]</font> &gt; hi"#);
        assert_eq!(html("ただのログ"), "ただのログ");
    }
}
