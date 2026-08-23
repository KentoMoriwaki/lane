/**
 * What closes the panel.
 *
 * A slot keeps its active subpage across client navigations unless something
 * else matches, so a navigation to any URL under `/lane` that is not an
 * intercepted task would otherwise leave the panel standing. This match returns
 * nothing, which is what "closing" means here.
 *
 * It is also what a direct visit to `/lane/task/<id>` resolves to: no
 * interception happens on a hard navigation, `children` renders the full task
 * page, and this slot stays empty.
 */
export default function ModalCatchAll() {
  return null;
}
