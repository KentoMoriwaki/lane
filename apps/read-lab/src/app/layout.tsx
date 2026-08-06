import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Read Lab",
  description:
    "A bench for watching what a use-lane read does over its life — failing, waiting, being collected, coming back.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
