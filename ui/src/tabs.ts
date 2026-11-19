// タブとキャラの対応の判断。App.tsx から出した

/** 判断に使うタブの部分 */
export type TabRef = { label: string; session: number; closed?: boolean };

/**
 * 登録したキャラを開く時にする事。タブがあればそのタブへ移り (switch)、切れていれば同じタブで繋ぎ直す (reconnect)。
 * 無ければ新しく接続する (connect)。一覧の「接続」もこれに従う。新しいタブを作ると、同じキャラのタブが二重に開いた (#133)
 */
export function characterTarget(
  tabs: TabRef[],
  label: string,
): { kind: "connect" } | { kind: "switch"; session: number } | { kind: "reconnect"; session: number } {
  const open = tabs.find((t) => t.label === label);
  if (!open) return { kind: "connect" };
  return open.closed ? { kind: "reconnect", session: open.session } : { kind: "switch", session: open.session };
}

/** タブを閉じる前に確かめるか。接続中なら、切断してログと priv の会話も捨てるので確かめる (#135) */
export const needsCloseConfirm = (tab: TabRef | undefined) => !!tab && !tab.closed;
