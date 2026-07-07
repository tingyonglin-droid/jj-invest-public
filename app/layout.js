import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "JJ Invest System Public",
  description: "公開版 Beta 再平衡試算工具",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
