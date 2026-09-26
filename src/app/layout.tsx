import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Color_Emoji } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoEmoji = Noto_Color_Emoji({
  variable: "--font-noto-emoji",
  weight: "400",
  subsets: ["emoji"],
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "Family board",
  description: "Calendar, weather, and Hue lights for your home display.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${notoEmoji.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
