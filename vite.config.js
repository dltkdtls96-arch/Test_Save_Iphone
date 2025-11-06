// /project/workspace/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // public/ 기준 경로만 적기 (실제 존재하는 파일만)
      includeAssets: [
        "apple-touch-icon.png",
        "icons/character03.png",
        // 필요하면 아래도 추가: "favicon.svg", "robots.txt"
      ],
      manifest: {
        name: "교번 캘린더",
        short_name: "교번",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0f172a",
        theme_color: "#0ea5e9",
        icons: [
          // 현재 확실한 아이콘만 등록(180x180)
          {
            src: "/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
          // 추후 준비되면 아래 2개도 추가 권장:
          // { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          // { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        // ✅ PNG 포함 → 행로표까지 프리캐시 (비행기 모드 100%)
        globPatterns: ["**/*.{js,css,html,png,webp,svg,ico,txt,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // 정적 이미지(해시된 /assets/* 포함) → CacheFirst
          {
            urlPattern:
              /\/(assets|icons|ansim)\/.*\.(?:png|jpg|jpeg|gif|webp|svg)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "assets-images",
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          // 스타일/폰트 → SWR
          {
            urlPattern: ({ request }) =>
              request.destination === "style" || request.destination === "font",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "assets-style-font" },
          },
          // 외부 CDN 스크립트만 SWR (중복 매치 방지)
          {
            urlPattern: ({ request, url }) =>
              request.destination === "script" &&
              url.origin !== self.location.origin,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "external-cdn" },
          },
        ],
      },
    }),
  ],
});
