import { labLog } from "@/lab/log";

// The one number this scene exists to count. Module scope, subscribed at a HUD
// leaf: the ask fires from a microtask outside render, so notifying listeners
// synchronously is safe, and keeping the subscription off the shell keeps the
// readers it observes from re-rendering (the loop the kit's README warns about).
let count = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export const refreshStore = {
  /** Called from the lane's `refresh`, just before `router.refresh()`. */
  bump(): number {
    count += 1;
    labLog.push("owner-ask:ask", "lane-op", `refresh() #${count}`);
    notify();
    return count;
  },
  reset(): void {
    count = 0;
    notify();
  },
  read(): number {
    return count;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
