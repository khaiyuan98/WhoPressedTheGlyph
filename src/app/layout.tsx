import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Who Pressed The Glyph? - Dota 2 Glyph Tracker",
  description:
    "Find out who used the Glyph of Fortification in any Dota 2 match",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
