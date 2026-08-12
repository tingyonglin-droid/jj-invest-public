import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Caveat } from "next/font/google";
import RegisterServiceWorker from "./register-service-worker.js";

const betreeWordmarkFont = Caveat({
  subsets: ["latin"],
  weight: "600",
  display: "swap",
  variable: "--font-betree",
});

export const metadata = {
  title: "Betree 曝險管理",
  description: "投資組合曝險管理與 Beta 再平衡工具",
  applicationName: "Betree 曝險管理",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Betree 曝險管理",
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
      <body className={betreeWordmarkFont.variable}>
        {children}
        <RegisterServiceWorker />
        <Analytics />
      </body>
    </html>
  );
}
