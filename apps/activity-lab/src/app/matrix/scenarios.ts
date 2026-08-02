import type { AgitatorKind } from "@/lab/agitator";
import type { LabLoaderMode } from "@/lab/loader";
import type { ReaderOpts } from "./quadrant";
import type { KeyId } from "./runtime";

export type MatrixOps = {
  mark(detail: string): void;
  sleep(ms: number): Promise<void>;
  setMode(mode: "visible" | "hidden"): void;
  remountScene(mode: "visible" | "hidden"): void;
  invalidate(which: KeyId): void;
  remove(which: KeyId): void;
  set(which: KeyId): void;
  update(which: KeyId): void;
  republish(): void;
  agitate(kind: AgitatorKind): void;
  resolveAll(): void;
  setLoaderMode(mode: LabLoaderMode): void;
  setLoaderDelay(ms: number): void;
  setReaderOpts(opts: ReaderOpts): void;
};

export class ScenarioAborted extends Error {
  constructor() {
    super("scenario aborted");
  }
}

export type Scenario = {
  id: number;
  title: string;
  /** What to watch — an observation aid, not an expected outcome. */
  focus: string;
  run(ops: MatrixOps): Promise<void>;
};

async function baseline(ops: MatrixOps) {
  ops.setLoaderMode("auto");
  ops.setLoaderDelay(200);
  ops.setMode("visible");
  await ops.sleep(500);
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 1,
    title: "hidden のまま mount",
    focus:
      "prerender で loader-call が出るか / probe が SUSPENDED のまま何を描くか(loader:mx:* と各象限の render)",
    async run(ops) {
      ops.setLoaderMode("auto");
      ops.setLoaderDelay(200);
      ops.mark("remount scene hidden");
      ops.remountScene("hidden");
      await ops.sleep(1200);
      ops.mark("observe: loader calls / renders while hidden");
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 2,
    title: "hide → invalidate → reveal",
    focus: "reveal の render と loader-call の順序、A/H 象限との横並び差",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("invalidate A -> all");
      ops.invalidate("a");
      await ops.sleep(700);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 3,
    title: "hide → remove → reveal",
    focus: "FrameStrip の赤フレーム(削除済み値)が reveal コミットに出るか",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A -> all");
      ops.remove("a");
      await ops.sleep(500);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 4,
    title: "hide → remove → reveal(useLanesAll 視点)",
    focus:
      "matrix:*:all(useLanesAll)の render / SUSPENDED と、単独 Probe との差",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A -> all (watch matrix:*:all)");
      ops.remove("a");
      await ops.sleep(500);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 5,
    title: "hide → snapshot 再 publish → reveal",
    focus: "H / AH で新 snapshot 値の採用が reveal の前か後か",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("snapshot republish (transition)");
      ops.republish();
      await ops.sleep(700);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 6,
    title: "reader オプション切替で reveal",
    focus:
      "refetchOnMount:true(staleTime 0)/ whenStale:'refetch'(staleTime 0)それぞれで reveal 時に loader が動くか",
    async run(ops) {
      await baseline(ops);
      // The "always" trigger form was removed upstream; true + staleTime: 0 is
      // the equivalent "refresh any settled value on mount".
      ops.mark("readerOpts: refetchOnMount=true staleTime=0");
      ops.setReaderOpts({ refetchOnMount: true, staleTime: 0 });
      await ops.sleep(400);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("reveal (refetchOnMount=true staleTime=0)");
      ops.setMode("visible");
      await ops.sleep(900);
      ops.mark("readerOpts: whenStale=refetch staleTime=0");
      ops.setReaderOpts({ whenStale: "refetch", staleTime: 0 });
      await ops.sleep(400);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("reveal (whenStale=refetch)");
      ops.setMode("visible");
      await ops.sleep(900);
      ops.mark("readerOpts reset");
      ops.setReaderOpts({});
      await ops.sleep(300);
    },
  },
  {
    id: 7,
    title: "hide 中 invalidate の loader 発火(購読の間接観測)",
    focus:
      "hidden の間に loader:mx:A / loader:mx:AH の loader-call が出るか、reveal で初めて出るか",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("invalidate A -> all");
      ops.invalidate("a");
      await ops.sleep(1200);
      ops.mark("observe: any loader-call while hidden?");
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 8,
    title: "remove 直後の urgent / flushSync(visible 同キー併読)",
    focus:
      "a1(zone 内)だけ urgent に render されたとき、a2 / a1-memo との間で「先に render された方だけ落ちた」フレームが出るか",
    async run(ops) {
      await baseline(ops);
      ops.mark("remove A + agitate urgent (same task)");
      ops.remove("a");
      ops.agitate("urgent");
      await ops.sleep(1000);
      ops.mark("restore: set A");
      ops.set("a");
      await ops.sleep(500);
      ops.mark("remove A + agitate flushSync (same task)");
      ops.remove("a");
      ops.agitate("flushSync");
      await ops.sleep(1000);
      ops.mark("restore: set A");
      ops.set("a");
      await ops.sleep(400);
    },
  },
  {
    id: 9,
    title: "mid-transition の reader に urgent",
    focus:
      "invalidate の background 収束中(manual loader が pending)に urgent が transition を追い越すか / SUSPENDED が出るか",
    async run(ops) {
      await baseline(ops);
      ops.mark("loaders -> manual");
      ops.setLoaderMode("manual");
      ops.mark("invalidate A -> refetch stays pending");
      ops.invalidate("a");
      await ops.sleep(500);
      ops.mark("agitate urgent mid-transition");
      ops.agitate("urgent");
      await ops.sleep(700);
      ops.mark("resolve all pending");
      ops.resolveAll();
      await ops.sleep(600);
      ops.mark("loaders -> auto");
      ops.setLoaderMode("auto");
      await ops.sleep(300);
    },
  },
  {
    id: 10,
    title: "hidden のまま contextTick(remove 後)",
    focus:
      "hidden の render で drop → 再 read → hidden 中に loader-call まで進むか(loader:mx:A / loader:mx:AH)",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A while hidden");
      ops.remove("a");
      await ops.sleep(400);
      ops.mark("agitate contextTick #1");
      ops.agitate("contextTick");
      await ops.sleep(500);
      ops.mark("agitate contextTick #2");
      ops.agitate("contextTick");
      await ops.sleep(900);
      ops.mark("observe: hidden renders / loader calls, then reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 11,
    title: "hidden のまま contextTick(snapshot 再 publish 後)",
    focus:
      "hidden handoff がどの render で採用されるか、loader / suspend を伴うか(H は対照の visible 側)",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("snapshot republish while hidden");
      ops.republish();
      await ops.sleep(500);
      ops.mark("agitate contextTick #1");
      ops.agitate("contextTick");
      await ops.sleep(500);
      ops.mark("agitate contextTick #2");
      ops.agitate("contextTick");
      await ops.sleep(900);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 12,
    title: "invalidate 直後の urgent(remove との対照)",
    focus:
      "通知経路のままの invalidate に、urgent 横入りで P2 のフラッシュ(古値の一瞬描画→再更新)が出る条件",
    async run(ops) {
      await baseline(ops);
      ops.mark("invalidate A + agitate urgent (same task)");
      ops.invalidate("a");
      ops.agitate("urgent");
      await ops.sleep(1000);
      ops.mark("invalidate A + agitate flushSync (same task)");
      ops.invalidate("a");
      ops.agitate("flushSync");
      await ops.sleep(1000);
    },
  },
  {
    id: 13,
    title: "visible × hidden の同キー併読 → remove → reveal",
    focus:
      "A/AH の outside(可視)と内側(hidden)の合流経路の差、reveal 時の一時的不整合",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide (outside stays visible)");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A -> all");
      ops.remove("a");
      await ops.sleep(800);
      ops.mark("reveal hidden co-reader");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 14,
    title: "hide → remove → set で復活 → reveal",
    focus: "古い promise の reader が「削除」と「新値あり」のどちらで合流するか",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A");
      ops.remove("a");
      await ops.sleep(400);
      ops.mark("set A (revive same key)");
      ops.set("a");
      await ops.sleep(500);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 15,
    title: "hide → remove → snapshot 再 publish で復活 → reveal",
    focus: "removal と re-hydration seed が同じ reveal で衝突したときの見え方",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(500);
      ops.mark("remove A");
      ops.remove("a");
      await ops.sleep(400);
      ops.mark("snapshot republish (revive via seed)");
      ops.republish();
      await ops.sleep(600);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 16,
    title: "invalidate→remove / remove→invalidate の連続",
    focus: "合成順で通知経路と render 時経路のどちらが残るか",
    async run(ops) {
      await baseline(ops);
      ops.mark("invalidate A then remove A (same task)");
      ops.invalidate("a");
      ops.remove("a");
      await ops.sleep(1000);
      ops.mark("restore: set A");
      ops.set("a");
      await ops.sleep(500);
      ops.mark("remove A then invalidate A (same task)");
      ops.remove("a");
      ops.invalidate("a");
      await ops.sleep(1000);
      ops.mark("restore: set A");
      ops.set("a");
      await ops.sleep(400);
    },
  },
  {
    id: 17,
    title: "reveal 直後に再 hide(素早い往復)",
    focus: "reveal コミット・catch-up effect・再 hide の順序と、途中フレーム",
    async run(ops) {
      await baseline(ops);
      ops.mark("hide");
      ops.setMode("hidden");
      await ops.sleep(400);
      ops.mark("remove A while hidden");
      ops.remove("a");
      await ops.sleep(300);
      ops.mark("reveal");
      ops.setMode("visible");
      await ops.sleep(60);
      ops.mark("hide again (60ms after reveal)");
      ops.setMode("hidden");
      await ops.sleep(700);
      ops.mark("final reveal");
      ops.setMode("visible");
      await ops.sleep(900);
    },
  },
  {
    id: 18,
    title: "StrictMode on/off で主要シナリオを再走",
    focus:
      "double render と render 時の WeakSet 照合の相性(#2 #3 #8 #10 #11 あたり)",
    async run(ops) {
      ops.mark(
        "manual: toggle StrictMode (header switch or ?strict=1), then re-run #2 #3 #8 #10 #11 and compare",
      );
      await ops.sleep(100);
    },
  },
];
