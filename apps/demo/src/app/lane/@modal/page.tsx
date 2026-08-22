/**
 * What closes the panel on the way back to the list.
 *
 * `default.tsx` covers a full page load and `[...catchAll]` covers every URL
 * *below* `/lane` — but a catch-all needs at least one segment, so neither of
 * them matches `/lane` itself. A slot keeps its active subpage across client
 * navigations unless something else matches, which meant Back from an open
 * panel left the panel standing beside the list it had returned to.
 *
 * This is the match for `/lane`, and it renders nothing. Next's own parallel
 * routes reference prescribes exactly this file for exactly this reason.
 */
export default function ModalClosed() {
  return null;
}
