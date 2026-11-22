import { Plus, Settings as SettingsIcon, X } from "lucide-react";
import type { Tab } from "./App";

export function TabBar(props: {
  tabs: Tab[];
  active: number | null;
  onSelect: (s: number | null) => void;
  onClose: (s: number) => void;
  onSettings: () => void;
}) {
  return (
    <div className="tab-bar">
      {props.tabs.map((t) => (
        <span
          key={t.session}
          className={[
            "tab",
            t.session === props.active ? "active" : t.unread ? "unread" : "",
            // 切れたタブは見た目で分かるようにする。モダンは状態欄を出さないので、他に知る手段が無い (#132)
            t.closed ? "closed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          title={t.closed ? "切断中。ファイルのメニューの「接続」で繋ぎ直せます" : undefined}
        >
          <button className="tab-label" onClick={() => props.onSelect(t.session)}>
            {t.session !== props.active && t.hurt && (
              <span className="tab-hurt" title="HP か MP が減りました">
                ♥
              </span>
            )}
            {t.label}
          </button>
          <button className="tab-close" title="切断して閉じる" onClick={() => props.onClose(t.session)}>
            <X />
          </button>
        </span>
      ))}
      <button className="tab" title="キャラを選んで接続する" onClick={() => props.onSelect(null)}>
        <Plus />
      </button>
      <button className="tab tab-settings" onClick={props.onSettings}>
        <SettingsIcon />
        設定
      </button>
    </div>
  );
}
