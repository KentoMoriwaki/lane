/**
 * The route's mark, rendered by the real sidebar and by its skeleton.
 *
 * Shared because the shell has to be the same box as the thing it precedes: a
 * brand that differs between the two is a visible jump on arrival.
 */
export function WorkspaceBrand() {
  return (
    <>
      <span className="flex size-6 items-center justify-center rounded-md bg-sage text-sm font-bold text-primary-foreground">
        L
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Lane
      </span>
    </>
  );
}
