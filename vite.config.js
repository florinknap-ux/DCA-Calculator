import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { VitePWA } from "vite-plugin-pwa"

const BASE = "/DCA-Calculator/"

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      base: BASE,
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "DCA + Corecții Calculator",
        short_name: "DCA Calc",
        description: "Calculator strategie DCA cu investiții la corecții de piață. Portofoliu 55% S&P 500, 35% STOXX Europe, 10% Gold.",
        theme_color: "#12141c",
        background_color: "#12141c",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/DCA-Calculator/",
        scope: "/DCA-Calculator/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        runtimeCaching: []
      }
    })
  ]
})
