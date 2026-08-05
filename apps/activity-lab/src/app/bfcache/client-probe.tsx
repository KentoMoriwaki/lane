"use client";

import { Probe } from "@/lab/probe";
import { bfClient } from "./reads";

/**
 * The client-owned probes, in their own module so `route-probes.tsx` can pull
 * them in with `ssr: false`.
 *
 * Which is not a detail — it is what the ownership split costs. A published
 * probe prerenders cleanly because its value comes from the payload: the server
 * seeds it, the client seeds it from the same serialized snapshot, and both
 * render the identical string. A client-owned probe has no such agreement.
 * Prerendering it runs its loader on the server, where the lab's relative
 * `/bfcache/api` URL has no origin — which is exactly the error the photo route
 * lived with, and it does not stay local: the route falls back to client
 * rendering wholesale, taking every hydration and keep-alive timing this scene
 * measures with it. Giving it an origin would not fix it either, only move it:
 * the server's fetch would take a version number the browser then fails to
 * match, so the probe would mismatch on hydration and the version counter would
 * lie.
 *
 * A key the browser owns is a key whose read begins in the browser. Saying that
 * to the bundler is both the honest statement and the one with no hydration to
 * disagree about.
 */
export default function ClientOwnedProbe({
  route,
  photoId,
}: {
  route: string;
  photoId?: string;
}) {
  const read =
    photoId === undefined ? bfClient.own(route) : bfClient.photo(photoId);

  return (
    <Probe
      channel={`bfcache:${route}:${photoId === undefined ? "client" : "own"}`}
      read={read}
      label={`client-owned — key ${JSON.stringify(read.key)}`}
    />
  );
}
