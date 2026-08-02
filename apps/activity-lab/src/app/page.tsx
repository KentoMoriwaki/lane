import Link from "next/link";

const scenes = [
  {
    href: "/matrix",
    title: "/matrix",
    description:
      "Hydration x Activity 2x2 quadrants with a shared operation panel (WS2).",
  },
  {
    href: "/bfcache",
    title: "/bfcache",
    description:
      "Real Next.js navigation under cacheComponents: router bfcache keep-alive (WS4).",
  },
  {
    href: "/outside-reader",
    title: "/outside-reader",
    description:
      "external reads: a layout-level reader outside every LaneHydration boundary, publishing / non-publishing sibling routes, and the WeakRef retention probe.",
  },
  {
    href: "/reveal-sync",
    title: "/reveal-sync",
    description:
      "The React-upgrade detector: does the unhide commit still re-create layout effects in the same task, so a reveal can be corrected before paint?",
  },
];

export default function IndexPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">Activity Lab</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Observation rig for use-lane under React {"<Activity>"} and the Next
          router bfcache. It measures what unit tests cannot — real paint,
          streaming order, actual GC — and is what gets re-run when React or
          Next is upgraded. Findings go to{" "}
          <code className="rounded bg-zinc-100 px-1">OBSERVATIONS.md</code>; see{" "}
          <code className="rounded bg-zinc-100 px-1">README.md</code> for the
          measurement discipline.
        </p>
      </div>
      <ul className="space-y-3">
        {scenes.map((scene) => (
          <li key={scene.href}>
            <Link
              href={scene.href}
              className="block rounded-lg border border-zinc-200 bg-white p-4 hover:border-zinc-400"
            >
              <span className="font-mono font-semibold">{scene.title}</span>
              <p className="mt-1 text-sm text-zinc-600">{scene.description}</p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">
        Append <code>?strict=1</code> to any URL (or use the header toggle) to
        wrap the tree in StrictMode.
      </p>
    </main>
  );
}
