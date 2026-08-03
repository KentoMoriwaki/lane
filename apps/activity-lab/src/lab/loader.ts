import type { LaneLoader } from "use-lane";
import { labLog } from "./log";

export type LabLoaderMode = "manual" | "auto";

export type LabLoader = {
  name: string;
  loader: LaneLoader<string>;
  readonly mode: LabLoaderMode;
  setMode(mode: LabLoaderMode): void;
  /** Settle the oldest unresolved call; the value defaults to the version assigned at call time. */
  resolveNext(value?: string): boolean;
  rejectNext(error?: unknown): boolean;
  setDelay(ms: number): void;
  readonly delay: number;
  readonly calls: number;
  readonly pending: number;
};

type PendingCall = {
  version: string;
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
};

export function createLabLoader(
  name: string,
  options: { mode?: LabLoaderMode; delay?: number } = {},
): LabLoader {
  const channel = `loader:${name}`;
  let mode: LabLoaderMode = options.mode ?? "manual";
  let delay = options.delay ?? 0;
  let calls = 0;
  const queue: PendingCall[] = [];

  const settle = (
    call: PendingCall,
    how: "resolve" | "reject",
    value: string,
    error?: unknown,
  ) => {
    if (how === "resolve") {
      labLog.push(channel, "loader-settle", `${call.version} -> ${value}`);
      call.resolve(value);
    } else {
      labLog.push(channel, "loader-settle", `${call.version} rejected`);
      call.reject(error);
    }
  };

  const loader: LaneLoader<string> = ({ key }) => {
    calls += 1;
    const version = `v${calls}`;
    labLog.push(
      channel,
      "loader-call",
      `${version} key=${JSON.stringify(key)} mode=${mode}`,
    );

    return new Promise<string>((resolve, reject) => {
      const call: PendingCall = { version, resolve, reject };

      if (mode === "auto") {
        setTimeout(() => settle(call, "resolve", version), delay);
        return;
      }

      queue.push(call);
    });
  };

  return {
    name,
    loader,
    get mode() {
      return mode;
    },
    setMode(next) {
      mode = next;
      labLog.push(channel, "custom", `mode=${next}`);
    },
    resolveNext(value) {
      const call = queue.shift();
      if (call === undefined) {
        labLog.push(channel, "custom", "resolveNext: nothing pending");
        return false;
      }

      settle(call, "resolve", value ?? call.version);
      return true;
    },
    rejectNext(error) {
      const call = queue.shift();
      if (call === undefined) {
        labLog.push(channel, "custom", "rejectNext: nothing pending");
        return false;
      }

      settle(call, "reject", call.version, error ?? new Error(`${name} rejected ${call.version}`));
      return true;
    },
    setDelay(ms) {
      delay = ms;
      labLog.push(channel, "custom", `delay=${ms}ms`);
    },
    get delay() {
      return delay;
    },
    get calls() {
      return calls;
    },
    get pending() {
      return queue.length;
    },
  };
}
