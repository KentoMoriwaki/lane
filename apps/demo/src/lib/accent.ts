/**
 * Maps the palette tokens the API stores ("sage" | "cobalt" | "rose" | "amber"
 * | "slate") onto Tailwind classes. Keeping the literal class strings here lets
 * the Tailwind scanner pick them up at build time.
 */
export type AccentToken = "sage" | "cobalt" | "rose" | "amber" | "slate";

type AccentClasses = {
  dot: string;
  text: string;
  soft: string;
  ring: string;
};

const accents: Record<AccentToken, AccentClasses> = {
  sage: {
    dot: "bg-sage",
    text: "text-sage",
    soft: "bg-sage/12 text-sage",
    ring: "ring-sage/30",
  },
  cobalt: {
    dot: "bg-cobalt",
    text: "text-cobalt",
    soft: "bg-cobalt/12 text-cobalt",
    ring: "ring-cobalt/30",
  },
  rose: {
    dot: "bg-rose",
    text: "text-rose",
    soft: "bg-rose/12 text-rose",
    ring: "ring-rose/30",
  },
  amber: {
    dot: "bg-amber",
    text: "text-amber",
    soft: "bg-amber/14 text-amber",
    ring: "ring-amber/30",
  },
  slate: {
    dot: "bg-slate-accent",
    text: "text-slate-accent",
    soft: "bg-slate-accent/12 text-slate-accent",
    ring: "ring-slate-accent/30",
  },
};

export function accent(token: string | null | undefined): AccentClasses {
  if (token && token in accents) {
    return accents[token as AccentToken];
  }
  return accents.slate;
}

/** Soft background used by avatars. */
export function avatarAccent(token: string | null | undefined): string {
  return accent(token).soft;
}
