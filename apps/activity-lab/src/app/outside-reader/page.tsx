import { QuietMarker } from "./page-parts";

export default function OutsideReaderIndexPage() {
  return (
    <main className="space-y-3">
      <h1 className="font-mono text-sm font-bold">/outside-reader</h1>
      <p className="text-xs text-zinc-600">
        The layout above holds one reader of{" "}
        <code className="rounded bg-zinc-200 px-1">[&quot;outside&quot;,&quot;topic&quot;]</code>{" "}
        with <code className="rounded bg-zinc-200 px-1">loader: external</code>.
        alpha / beta / gamma publish that key with different values; this page and
        quiet publish nothing.
      </p>
      <QuietMarker route="index" />
    </main>
  );
}
