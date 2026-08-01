// Real-world modal shape: without this, a soft navigation to any other route
// leaves the slot showing its previous state (the modal stays open). A
// catch-all matches every path, takes precedence over default.tsx, and closes
// the modal by rendering the slot empty.
export default function ModalCatchAll() {
  return null;
}
