// 確かめと知らせのダイアログ。main 窓の中に描く。
// window.confirm と window.alert は WebView によって出ず、confirm は黙って false を返す
// (macOS で Call と Return が唱えられなかった)。どの OS でも同じに出す為、自分で描く
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

type Request = { message: string; confirm: boolean; resolve: (ok: boolean) => void };

let show: ((r: Request) => void) | null = null;

/** はい・いいえで確かめる。いいえか Esc なら false */
export const confirmBox = (message: string) =>
  new Promise<boolean>((resolve) => (show ? show({ message, confirm: true, resolve }) : resolve(false)));

/** 知らせる。閉じたら終わる */
export const alertBox = (message: string) =>
  new Promise<void>((resolve) => (show ? show({ message, confirm: false, resolve: () => resolve() }) : resolve()));

/** App に1つ置く。開いている間に次が来たら、前のを取り消して出す */
export function MessageDialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    show = (r) =>
      setReq((prev) => {
        prev?.resolve(false);
        return r;
      });
    return () => {
      show = null;
    };
  }, []);
  if (!req) return null;
  const answer = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  return (
    <div className="ask-backdrop">
      <div
        className="ask-dialog"
        role="dialog"
        // キーを Philly の操作にしない
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") answer(false);
        }}
      >
        <p className="message-text">{req.message}</p>
        <div className="confirm-buttons">
          {/* Philly と同じく、確かめは「いいえ」に初めから合わせる */}
          {req.confirm ? (
            <>
              <button type="button" onClick={() => answer(true)}>
                <Check />
                はい
              </button>
              <button type="button" autoFocus onClick={() => answer(false)}>
                <X />
                いいえ
              </button>
            </>
          ) : (
            <button type="button" autoFocus onClick={() => answer(true)}>
              <Check />
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
