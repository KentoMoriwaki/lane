import type { Metadata } from "next";
import "./globals.css";
import { StrictModeGate } from "./strict-mode-gate";

export const metadata: Metadata = {
  title: "Activity Lab",
  description:
    "Observation rig for use-lane under React <Activity> and the Next.js router bfcache.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <StrictModeGate>{children}</StrictModeGate>
      </body>
    </html>
  );
}
