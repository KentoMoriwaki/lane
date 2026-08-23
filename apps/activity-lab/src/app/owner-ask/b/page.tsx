import { OpsPanel } from "../ops";

// Publishes nothing and reads nothing. Its only job is to be somewhere else:
// standing here, route A is a hidden <Activity> whose readers are the only
// readers of K1 K2 K3, so every write made from this panel lands on a key
// nobody is looking at. Fully static, so navigating here adds no server render
// to the count.
export default function OwnerAskBPage() {
  return (
    <main className="space-y-3" data-route="b">
      <h1 className="font-mono text-sm font-bold">
        /owner-ask/b — publishes nothing, reads nothing
      </h1>
      <p className="text-sm text-zinc-600">
        A is now a hidden <code>{"<Activity>"}</code>. Writes made from here go
        to keys whose only readers are inside it: <code>set</code> hands the
        hidden reader a value, <code>invalidate</code> empties the entry and
        nothing asks the owner until the reveal re-reads it.
      </p>
      <OpsPanel where="b" />
    </main>
  );
}
