/**
 * The props baseline's mark. See `@/app/lane/workspace/brand` — same reason,
 * different route.
 */
export function WorkspaceBrand() {
  return (
    <>
      <span className="flex size-6 items-center justify-center rounded-md bg-cobalt text-sm font-bold text-primary-foreground">
        A
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        App Router
      </span>
      <span className="ml-auto rounded-full border px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
        props
      </span>
    </>
  );
}
