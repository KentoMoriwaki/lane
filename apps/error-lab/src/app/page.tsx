"use client";

import dynamic from "next/dynamic";

// Client only, on purpose. Rendering this on the server would build a world
// there too and run its loader — and "how many times did the loader run" stops
// being a question with one answer.
const ErrorLab = dynamic(() => import("@/lab/lab").then((m) => m.ErrorLab), {
  ssr: false,
});

export default function Page() {
  return <ErrorLab />;
}
