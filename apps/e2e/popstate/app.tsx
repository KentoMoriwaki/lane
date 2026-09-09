import { Activity, StrictMode, Suspense, use } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Link, Outlet, Route, Routes, useLocation } from "react-router";
import { createLane, LaneProvider, useLane } from "use-lane";

const params = new URLSearchParams(location.search);
const activity = params.has("activity");
const readers = params.has("multiple") ? 2 : 1;
const refetchOnMount = !params.has("no-refetch");
const lane = createLane({ gcTime: Infinity });
const source = { value: 1, loads: 0, completed: 0, pops: 0 };
addEventListener("popstate", () => source.pops++);
Object.assign(window, { source });

function Reader() {
  const { promise } = useLane({
    key: ["tasks"],
    loader: async () => {
      source.loads++;
      const value = source.value;
      await new Promise(resolve => setTimeout(resolve, 300));
      source.completed++;
      return value;
    },
    refetchOnMount,
    staleTime: 0,
  });
  return <p data-testid="tasks">Tasks {use(promise).data}</p>;
}

function Tasks() {
  return Array.from({ length: readers }, (_, i) => <Reader key={i} />);
}

function Shell() {
  return <>
    <nav><Link to="/tasks">Tasks</Link> <Link to="/journal">Journal</Link></nav>
    <Suspense fallback={<p aria-busy="true">Loading tasks</p>}><Outlet /></Suspense>
  </>;
}

function KeptRoutes() {
  const { pathname } = useLocation();
  return <>
    <Activity mode={pathname === "/tasks" ? "visible" : "hidden"}><Tasks /></Activity>
    {pathname !== "/tasks" && <p data-testid="journal">Journal</p>}
  </>;
}

const app = <LaneProvider lane={lane}><HashRouter><Routes>
  <Route element={<Shell />}>
    {activity ? <Route path="*" element={<KeptRoutes />} /> : <>
      <Route path="/tasks" element={<Tasks />} />
      <Route path="*" element={<p data-testid="journal">Journal</p>} />
    </>}
  </Route>
</Routes></HashRouter></LaneProvider>;
createRoot(document.getElementById("root")!).render(params.has("strict") ? <StrictMode>{app}</StrictMode> : app);
