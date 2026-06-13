import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "use-lane demo",
  description:
    "The same team-task workspace, implemented with use-lane and TanStack Query.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
