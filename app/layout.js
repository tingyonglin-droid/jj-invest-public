import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import RegisterServiceWorker from "./register-service-worker.js";

export const metadata = {
  title: "JJ Invest System Public",
  description: "公開版 Beta 再平衡試算工具",
  applicationName: "JJ Invest System",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "JJ Invest System",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  themeColor: "#f6f7f9",
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>
        {children}
        <RegisterServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
