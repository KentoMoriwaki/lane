import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Error Lab",
  description:
    "A bench for deciding use-lane's error-handling spec by watching what actually happens.",
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
