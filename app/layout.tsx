import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知习 · USM Study Studio",
  description: "读懂一页，记住一点。六门课程的课件、笔记与间隔复习工作台。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
