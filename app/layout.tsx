import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hatume Security — Guard Monitor",
  description: "Clock-in monitoring for Hatume Security guards",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
