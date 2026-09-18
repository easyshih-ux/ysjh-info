import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "義學公務資訊站",
  description: "快速查看校內本週重要事項、即將截止與歷史公告。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
