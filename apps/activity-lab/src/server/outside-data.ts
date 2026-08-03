/**
 * The /outside-reader scene's server-side version counter.
 *
 * One global sequence rather than one per route, so a value's number alone says
 * which publication it was: `alpha v1` → `beta v2` → `alpha v3` reads as the
 * order the server actually produced them in, which is exactly what "last
 * publication wins" has to be judged against.
 */
export type OutsideTopic = { text: string; n: number };

let counter = 0;

export function nextTopic(label: string): OutsideTopic {
  const n = ++counter;

  return { n, text: `${label} v${n} (rsc)` };
}
