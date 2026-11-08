// EagleEye 窓(Philly の EagleEyeForm と EagleEye.cpp の classEagleEye::Draw)。
// main 窓が eagleEye イベントを EAGLE_EYE_EVENT で送り、窓を表示する。
import { listen } from "@tauri-apps/api/event";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { assetUrl } from "./asset";
import { drawMap } from "./drawMap";
import { CHIP_SIZE } from "./mapRender";
import { eagleBoard } from "./eagleBoard.ts";
import { EAGLE_EYE_EVENT, type EagleEyeEvent } from "./protocol";
import { hideOnClose, useImages, preventBrowserDefaults, useScreenshot } from "./windowUtil";
import "./style.css";

function EagleEyeWindow() {
  const [ev, setEv] = useState<EagleEyeEvent | null>(null);
  const [, setLoaded] = useState(0);
  const image = useImages(() => setLoaded((n) => n + 1));
  const canvas = useRef<HTMLCanvasElement>(null);
  useScreenshot("eagleeye", canvas);

  useEffect(() => {
    hideOnClose();
    const unlisten = listen<EagleEyeEvent>(EAGLE_EYE_EVENT, (e) => setEv(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const board = ev ? eagleBoard(ev) : null;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !ev || !board) return;
    const mapset = ev.mapset ?? "";
    drawMap(
      ctx,
      { size: board.dim, dim: board.dim, mapset, cells: board.cells, chars: board.chars, eagleEye: true },
      { chip: image(assetUrl("chip", { mapset })), items: image(assetUrl("items")), chara: image },
      0,
    );
  });

  const px = (board?.dim ?? 15) * CHIP_SIZE;
  return (
    <div className="eagleeye-window">
      <canvas ref={canvas} width={px} height={px} />
    </div>
  );
}

preventBrowserDefaults();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EagleEyeWindow />
  </StrictMode>,
);
