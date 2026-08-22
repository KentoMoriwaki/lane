// Driver for the /owner-ask scene. Not part of apps/e2e's suite — nothing here
// asserts; it reproduces six sequences and prints what was seen, which is the
// only thing a measurement rig is allowed to produce.
//
//   pnpm --filter @lane/activity-lab exec next build
//   pnpm --filter @lane/activity-lab exec next start -p 3007
//   node apps/activity-lab/scripts/owner-ask.mjs [m1 m2 …]
//
// Chromium comes from apps/e2e's @playwright/test — the lab declares no
// Playwright dependency of its own. Headless counts as visible (rAF ticks,
// PPR's dynamic holes hydrate); an inactive tab does not, and every number
// below would silently read zero. See README.md.

import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../e2e/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = process.env.OWNER_ASK_BASE ?? "http://localhost:3007";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.owner-ask-run.json",
);

/**
 * A frame recorder that only ever looks at what is on screen. Hidden Activity
 * trees keep their DOM (`display: none`), so an unfiltered `querySelector`
 * reads the hidden tree's value and every reveal looks clean — the trap the
 * /outside-reader session recorded. `raf` is the paint discriminator: a frame
 * with `raf: 0` was committed and replaced without a paint boundary ever
 * sampling it, so it (almost certainly) never reached the screen.
 */
function installRecorder() {
  const w = /** @type {any} */ (window);

  if (w.__oa) {
    w.__oa.stop();
  }

  const t0 = performance.now();
  const frames = [];
  const marks = [];
  const area = document.querySelector("[data-route-area]");

  const visible = (element) => element.offsetParent !== null;

  const sample = () => {
    if (!area) {
      return "(no route area)";
    }

    const parts = [];

    for (const probe of area.querySelectorAll("[data-probe]")) {
      if (!visible(probe)) continue;
      const name = (probe.getAttribute("data-probe") ?? "").replace(
        "owner-ask:",
        "",
      );
      // A Suspense boundary that falls back *after* mounting does not remove
      // the old children — it sets `display: none` on them and adds the
      // fallback beside them. So the value element's own visibility is the
      // question, not its presence: reading presence alone reports the stale
      // value for the whole fallback window and hides every fallback frame.
      const value = probe.querySelector("[data-probe-value]");
      parts.push(
        `${name}=${value && visible(value) ? value.textContent : "SUSPENDED"}`,
      );
    }

    for (const seed of area.querySelectorAll("[data-seed-fallback]")) {
      if (visible(seed)) parts.push("SEED-FALLBACK");
    }

    const badge = Array.from(
      area.querySelectorAll("[data-server-renders]"),
    ).find(visible);
    if (badge) parts.push(`srv#${badge.getAttribute("data-server-renders")}`);

    const route = Array.from(area.querySelectorAll("[data-route]")).find(visible);

    return `[${route ? route.getAttribute("data-route") : "?"}] ${
      parts.length > 0 ? parts.join(" | ") : "(no probes)"
    }`;
  };

  const capture = (source) => {
    const text = sample();
    const last = frames[frames.length - 1];

    if (last && last.text === text) {
      last.count += 1;
      if (source === "raf") last.raf += 1;
      return;
    }

    frames.push({
      t: Number((performance.now() - t0).toFixed(1)),
      text,
      count: 1,
      raf: source === "raf" ? 1 : 0,
    });
  };

  let rafId = requestAnimationFrame(function tick() {
    capture("raf");
    rafId = requestAnimationFrame(tick);
  });

  // A commit and its correction can both land between two rAF ticks; the
  // observer catches the sub-frame states the loop would miss.
  const observer = new MutationObserver(() => capture("mutation"));
  if (area) {
    observer.observe(area, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "hidden"],
    });
  }

  w.__oa = {
    t0,
    frames,
    marks,
    mark: (label) => {
      marks.push({
        t: Number((performance.now() - t0).toFixed(1)),
        label,
      });
    },
    stop: () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mark(page, label) {
  await page.evaluate((text) => window.__oa?.mark(text), label);
}

async function refreshCount(page) {
  return page.$eval("[data-refresh-count]", (el) =>
    Number(el.getAttribute("data-refresh-count")),
  );
}

async function serverRenders(context) {
  const response = await context.request.get(`${BASE}/owner-ask/api`);
  return (await response.json()).renders;
}

async function setDelay(request, delayMs) {
  await request.post(`${BASE}/owner-ask/api`, { data: { delay: delayMs } });
}

async function collect(page) {
  await sleep(200); // the lab log notifies on a rAF / 60ms backstop
  return page.evaluate(() => {
    const oa = window.__oa;
    oa.stop();
    const events = (window.__labLog?.snapshot() ?? []).map((event) => ({
      t: Number((event.t - oa.t0).toFixed(1)),
      channel: event.channel,
      kind: event.kind,
      detail: event.detail,
    }));

    return { frames: oa.frames, marks: oa.marks, events };
  });
}

async function openScene(browser, delayMs) {
  const context = await browser.newContext();
  // The delay is process state, not per-session: the publishing route reaches
  // for `connection()` and nothing else, so its render count stays one per
  // render (a cookie or a search param would double it — see `currentDelay`).
  await setDelay(context.request, delayMs);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(`${BASE}/owner-ask/a`, { waitUntil: "load" });
  await page.waitForSelector('[data-probe="owner-ask:k1"] [data-probe-value]', {
    timeout: 20_000,
  });

  return { context, page, consoleErrors };
}

async function start(page) {
  await page.click('[data-op="reset"]');
  await page.evaluate(installRecorder);
}

async function toB(page) {
  await mark(page, "click nav → /owner-ask/b");
  await page.click('[data-nav="/owner-ask/b"]');
  await page.waitForSelector('[data-ops="b"]', { state: "visible" });
}

async function back(page) {
  await mark(page, "page.goBack()");
  await page.goBack();
  await page.waitForSelector('[data-route="a"]', { state: "visible" });
}

/** 1. hidden `set` → reveal. */
async function m1(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 600);
  const before = await serverRenders(context);
  await start(page);

  await toB(page);
  await sleep(300);
  await mark(page, 'click set K1 → lane.set(K1, "client-v2")');
  await page.click('[data-ops="b"] [data-op="set-k1"]');
  await sleep(300);
  await back(page);
  await sleep(2000);

  const result = await collect(page);
  const out = {
    ...result,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

/** 2. visible invalidate → SWR. */
async function m2(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 600);
  const before = await serverRenders(context);
  await start(page);

  await mark(page, "click invalidate K1 on A (reader visible)");
  await page.click('[data-ops="a"] [data-op="invalidate-k1"]');
  await sleep(2500);

  const result = await collect(page);
  const out = {
    ...result,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

/** 3. hidden invalidate → back. */
async function m3(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 600);
  const before = await serverRenders(context);
  await start(page);

  await toB(page);
  await sleep(300);
  await mark(page, "click invalidate K1 on B (reader hidden)");
  await page.click('[data-ops="b"] [data-op="invalidate-k1"]');
  await sleep(700);

  const onB = {
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
  };
  await mark(page, `while still on B: refresh=${onB.refresh}`);

  await back(page);
  await sleep(3000);

  const result = await collect(page);
  const out = {
    ...result,
    onB,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

/** 4. refresh discarded by navigation → self-repair. */
async function m4(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 1500);
  const before = await serverRenders(context);
  await start(page);

  await mark(page, "click invalidate K1 on A (delay 1500ms)");
  await page.click('[data-ops="a"] [data-op="invalidate-k1"]');
  await sleep(200);
  await toB(page);
  await sleep(2500); // past the 1500ms the discarded render would have taken

  const onB = {
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
  };
  await mark(page, `while still on B: refresh=${onB.refresh}`);

  await back(page);
  await sleep(4500);

  const result = await collect(page);
  const out = {
    ...result,
    onB,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

/** 5. burst coalescing. */
async function m5(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 600);
  const before = await serverRenders(context);
  await start(page);

  await mark(page, "click invalidate K1+K2+K3 on A (one synchronous run)");
  await page.click('[data-ops="a"] [data-op="invalidate-all"]');
  await sleep(2500);

  const result = await collect(page);
  const out = {
    ...result,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

/** 6. hidden `update` → reveal — (1) with the promise Lane does not stamp. */
async function m6(browser) {
  const { context, page, consoleErrors } = await openScene(browser, 600);
  const before = await serverRenders(context);
  await start(page);

  await toB(page);
  await sleep(300);
  await mark(page, 'click update K1 → lane.update(K1, () => "client-u1")');
  await page.click('[data-ops="b"] [data-op="update-k1"]');
  await sleep(300);
  await back(page);
  await sleep(2000);

  const result = await collect(page);
  const out = {
    ...result,
    refresh: await refreshCount(page),
    serverRenders: (await serverRenders(context)) - before,
    consoleErrors,
  };
  await context.close();
  return out;
}

const MEASUREMENTS = {
  m1: ["hidden set → reveal", m1],
  m2: ["visible invalidate → SWR", m2],
  m3: ["hidden invalidate → back", m3],
  m4: ["refresh discarded by navigation → self-repair", m4],
  m5: ["burst coalescing (K1+K2+K3, one run)", m5],
  m6: ["hidden update → reveal", m6],
};

function report(name, title, data) {
  const lines = [];
  lines.push("");
  lines.push(`=== ${name}: ${title} ===`);
  lines.push(
    `refresh() calls: ${data.refresh}   server renders (delta): ${data.serverRenders}` +
      (data.onB ? `   [midpoint on B: refresh=${data.onB.refresh}, renders=${data.onB.serverRenders}]` : ""),
  );

  lines.push("");
  lines.push("--- frames (visible route area; raf:0 = never painted) ---");
  const timed = [
    ...data.frames.map((f) => ({ ...f, sort: f.t, kind: "frame" })),
    ...data.marks.map((m) => ({ ...m, sort: m.t, kind: "mark" })),
  ].sort((a, b) => a.sort - b.sort);

  for (const row of timed) {
    if (row.kind === "mark") {
      lines.push(`  ${String(row.t).padStart(8)}  ▸ ${row.label}`);
    } else {
      lines.push(
        `  ${String(row.t).padStart(8)}  x${String(row.count).padEnd(4)} raf:${String(
          row.raf,
        ).padEnd(4)} ${row.text}`,
      );
    }
  }

  lines.push("");
  lines.push("--- timeline (repeats of one event collapsed) ---");
  // A suspended reader re-renders on every parent render and the route's own
  // fallback re-renders with it, so a 600ms round trip is ~40 identical lines.
  // Collapsing them keeps the shape of the window without burying it.
  const runs = [];
  for (const event of data.events) {
    const last = runs.at(-1);
    const same =
      last &&
      last.kind === event.kind &&
      last.channel === event.channel &&
      last.detail === event.detail;

    if (same) {
      last.count += 1;
      last.until = event.t;
    } else {
      runs.push({ ...event, count: 1, until: event.t });
    }
  }

  for (const run of runs) {
    const span =
      run.count > 1 ? ` x${run.count} (…${run.until}ms)` : "";
    lines.push(
      `  ${String(run.t).padStart(8)}  ${run.kind.padEnd(16)} ${run.channel.padEnd(
        24,
      )} ${run.detail ?? ""}${span}`,
    );
  }

  if (data.consoleErrors.length > 0) {
    lines.push("");
    lines.push("--- console errors ---");
    for (const error of data.consoleErrors) lines.push(`  ${error}`);
  }

  return lines.join("\n");
}

async function main() {
  const requested = process.argv.slice(2).filter((arg) => arg in MEASUREMENTS);
  const names = requested.length > 0 ? requested : Object.keys(MEASUREMENTS);

  const browser = await chromium.launch();
  const results = {};
  const text = [];

  try {
    for (const name of names) {
      const [title, run] = MEASUREMENTS[name];
      const data = await run(browser);
      results[name] = { title, ...data };
      const rendered = report(name, title, data);
      text.push(rendered);
      console.log(rendered);
    }
  } finally {
    await browser.close();
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${OUT}`);
}

await main();
