import { connection } from "next/server";
import {
  currentDelay,
  serverRenderCount,
  setDelay,
} from "@/server/owner-ask-data";

// The driver reads the render count out of band: an HTTP request to this
// handler is not an RSC render of /owner-ask/a, so polling it cannot perturb
// the number it reports. The page renders the same counter into the DOM for a
// human reading the scene by hand.
export async function GET() {
  await connection();

  return Response.json({ renders: serverRenderCount(), delay: currentDelay() });
}

// The delay knob. A POST rather than a cookie so the page's own render reaches
// for `connection()` and nothing else — see `currentDelay` for why that matters
// to the render count.
export async function POST(request: Request) {
  await connection();

  const body = (await request.json()) as { delay?: number };

  return Response.json({
    renders: serverRenderCount(),
    delay: setDelay(Number(body.delay)),
  });
}
