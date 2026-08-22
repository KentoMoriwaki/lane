/**
 * The panel's empty state, and it is nothing at all.
 *
 * On a full page load Next cannot know what an unmatched slot was showing, so
 * it renders this. At `/lane` that is exactly right: no task is open, the list
 * takes the full width, and there is no "No task selected" placeholder to draw
 * because there is no panel.
 */
export default function ModalDefault() {
  return null;
}
