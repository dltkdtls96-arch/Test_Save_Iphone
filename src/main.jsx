// /project/workspace/src/main.jsx
import React from "react";
import "./index.css";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { registerSW } from "virtual:pwa-register";

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    /* 업데이트 알림 띄우기 */
  },
  onOfflineReady() {
    /* 오프라인 준비됨 토스트 등 */
  },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
