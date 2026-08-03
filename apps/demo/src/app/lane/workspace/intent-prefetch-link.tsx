"use client";

import Link from "next/link";
import * as React from "react";

type IntentPrefetchLinkProps = Omit<
  React.ComponentProps<typeof Link>,
  "prefetch" | "unstable_dynamicOnHover"
>;

// The Preview runtime and its app-dir Link declaration expose this prop, while
// the package's public `next/link` wrapper has not surfaced it in its type yet.
const PreviewLink = Link as React.ComponentType<
  React.ComponentProps<typeof Link> & { unstable_dynamicOnHover?: boolean }
>;

/**
 * Runtime-prefetch URL-specific workspace data only after pointer intent.
 *
 * The default prefetch stays bounded to one App Shell for `/lane`. With
 * `experimental.dynamicOnHover`, this prop lets Next's own Link scheduler
 * upgrade a hovered/touched destination to the equivalent of `prefetch={true}`:
 * a per-link prerender that resolves `searchParams` through our `use cache`
 * reads. Keyboard navigation still has the instant App Shell as its baseline.
 */
export const IntentPrefetchLink = React.forwardRef<
  HTMLAnchorElement,
  IntentPrefetchLinkProps
>(function IntentPrefetchLink(props, ref) {
  return (
    <PreviewLink
      {...props}
      ref={ref}
      unstable_dynamicOnHover
    />
  );
});
