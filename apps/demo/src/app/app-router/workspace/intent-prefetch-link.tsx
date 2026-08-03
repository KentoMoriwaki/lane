"use client";

import Link from "next/link";
import * as React from "react";

type IntentPrefetchLinkProps = Omit<
  React.ComponentProps<typeof Link>,
  "prefetch" | "unstable_dynamicOnHover"
>;

const PreviewLink = Link as React.ComponentType<
  React.ComponentProps<typeof Link> & { unstable_dynamicOnHover?: boolean }
>;

/** Upgrade URL-specific props from the App Shell only after pointer intent. */
export const IntentPrefetchLink = React.forwardRef<
  HTMLAnchorElement,
  IntentPrefetchLinkProps
>(function IntentPrefetchLink(props, ref) {
  return <PreviewLink {...props} ref={ref} unstable_dynamicOnHover />;
});
