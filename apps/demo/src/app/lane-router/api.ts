/**
 * A tiny in-memory API with artificial latency, local to this route. It exists
 * only to make the router/use-lane behavior visible: every read waits ~900ms and
 * stamps `loadedAt` + a `fetch` counter, so a refetch is observable while the
 * previous UI stays on screen.
 */

export type User = { id: string; name: string; role: string; email: string };
export type Post = { id: string; title: string; authorId: string; excerpt: string };

const USERS: User[] = [
  { id: "u1", name: "Aoi Tanaka", role: "Engineering", email: "aoi@example.com" },
  { id: "u2", name: "Ben Carter", role: "Design", email: "ben@example.com" },
  { id: "u3", name: "Chioma Eze", role: "Product", email: "chioma@example.com" },
  { id: "u4", name: "Daniel Kim", role: "Engineering", email: "daniel@example.com" },
  { id: "u5", name: "Elena Ruiz", role: "Marketing", email: "elena@example.com" },
  { id: "u6", name: "Farid Aziz", role: "Engineering", email: "farid@example.com" },
  { id: "u7", name: "Grace Park", role: "Design", email: "grace@example.com" },
  { id: "u8", name: "Hiroshi Sato", role: "Product", email: "hiroshi@example.com" },
];

const POSTS: Post[] = [
  { id: "p1", title: "Shipping transitions without flashing", authorId: "u1", excerpt: "Keep the old screen live while the next data loads." },
  { id: "p2", title: "Designing for pending states", authorId: "u2", excerpt: "A pending bar beats a fallback flash." },
  { id: "p3", title: "Roadmap: Q3 themes", authorId: "u3", excerpt: "What we're betting on next." },
  { id: "p4", title: "Promise identity as a primitive", authorId: "u4", excerpt: "Who owns the cache, who owns the UI." },
  { id: "p5", title: "Suspense, transitions, and you", authorId: "u6", excerpt: "When each one is the right tool." },
  { id: "p6", title: "From query cache to source invalidation", authorId: "u8", excerpt: "Mutate the source, re-read the data." },
];

const LATENCY_MS = 900;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

let fetchCounter = 0;
function stamp() {
  return { loadedAt: new Date().toLocaleTimeString(), fetch: ++fetchCounter };
}

export async function fetchUsers(signal?: AbortSignal) {
  await sleep(LATENCY_MS, signal);
  return { users: USERS, ...stamp() };
}

export async function fetchUser(id: string, signal?: AbortSignal) {
  await sleep(LATENCY_MS, signal);
  const user = USERS.find((u) => u.id === id);
  if (!user) throw new Error(`User "${id}" not found`);
  const posts = POSTS.filter((p) => p.authorId === id);
  return { user, posts, ...stamp() };
}

export async function fetchPosts(signal?: AbortSignal) {
  await sleep(LATENCY_MS, signal);
  return { posts: POSTS, ...stamp() };
}

export function userName(id: string): string {
  return USERS.find((u) => u.id === id)?.name ?? id;
}

/* ------------------------------ Mutations ------------------------------ */

/**
 * Writes, such as they are: they change the arrays above — the source the
 * loaders read — and nothing else. Nobody hands the result to the UI, because
 * the UI is not where a change is applied here. The caller revalidates, the
 * router re-runs its loader, and the new value reaches the screen the same way
 * every other value does.
 *
 * That indirection is the entire point of the button in this demo. Editing the
 * cached copy instead would show the same thing on screen for a moment and then
 * lose it at the next navigation, when the loader publishes the source's
 * unchanged version over the top.
 */
export function promoteFirstUser(): void {
  const [first] = USERS;
  if (first) {
    first.name = star(first.name);
  }
}

export function promoteFirstPost(): void {
  const [first] = POSTS;
  if (first) {
    first.title = star(first.title);
  }
}

function star(value: string): string {
  return value.startsWith("★ ") ? value : `★ ${value}`;
}

/* --------------------- What each loader publishes ---------------------- */

export type UsersData = Awaited<ReturnType<typeof fetchUsers>>;
export type UserData = Awaited<ReturnType<typeof fetchUser>>;
export type PostsData = Awaited<ReturnType<typeof fetchPosts>>;
