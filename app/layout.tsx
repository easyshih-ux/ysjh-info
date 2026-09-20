import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "義學公務資訊站",
  description: "義學國中校務與公務資訊整合平台",
  manifest: "/ysjh-info/manifest.webmanifest",
  icons: {
    icon: "/ysjh-info/favicon.ico",
    shortcut: "/ysjh-info/favicon.ico",
    apple: "/ysjh-info/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "義學公務",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#173B63",
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
