// map 窓の起動。中身は map.tsx の MapView
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MapView } from "./map";
import { preventBrowserDefaults } from "./windowUtil";
import "./style.css";

preventBrowserDefaults();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MapView />
  </StrictMode>,
);
