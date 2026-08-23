/**
 * The variant registry for the lab's chrome.
 *
 * Metadata only — no implementation is imported here, and the switcher is plain
 * navigation between routes. That is the entire relationship between variants:
 * they are separate pages that happen to measure the same endpoint with the
 * same stopwatch. Adding `infinite/lane/` later means writing that page and
 * flipping `available` to true.
 */
export type VariantId = "react-query" | "lane";

export type LabVariantInfo = {
  id: VariantId;
  href: string;
  name: string;
  badge: string;
  tagline: string;
  available: boolean;
};

export const LAB_VARIANTS: LabVariantInfo[] = [
  {
    id: "react-query",
    href: "/infinite/react-query",
    name: "TanStack Query",
    badge: "useInfiniteQuery",
    tagline:
      "The reference behaviour: one query entry holding an array of pages, cursors re-derived from the previous page via getNextPageParam.",
    available: true,
  },
  {
    id: "lane",
    href: "/infinite/lane",
    name: "use-lane",
    badge: "useInfiniteLane",
    tagline:
      "One key holds the accumulated list: load-more is a lane.update, a re-read is the first page (the depth is the browser's to buy back), and the list is held on screen by transitions rather than a status object.",
    available: true,
  },
];
