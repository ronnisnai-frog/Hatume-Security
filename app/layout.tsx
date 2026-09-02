import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hatume Security — Guard Monitor",
  description: "Clock-in monitoring for Hatume Security guards",
  manifest: "/manifest.json",
  themeColor: "#0B0C0E",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hatume Security",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
