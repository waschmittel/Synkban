import type { LuaFactory } from "wasmoon";
import {
  LUA_TIMEOUT_MSG,
  evaluateLuaWithFactory,
  hashLuaCode,
  type LuaEvalResult,
} from "./luaEval";

export { hashLuaCode };
export type { LuaEvalResult };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (r: LuaEvalResult) => void; timer: ReturnType<typeof setTimeout> }
>();

let fallbackFactory: LuaFactory | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./luaWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<LuaEvalResult & { id: number }>) => {
      const { id, output, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.resolve({ output, error });
    };
    worker.onerror = (event) => {
      const msg = event.message || "Lua worker error";
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({ output: null, error: msg });
      }
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/// Evaluates `code` in a sandboxed Lua 5.4 Web Worker with a hard timeout
/// (terminating the worker on infinite loops), falling back to an in-process
/// WASM engine in non-Worker environments (Vitest / Node).
export async function runLua(code: string, timeoutMs = 1500): Promise<LuaEvalResult> {
  if (typeof Worker === "undefined") {
    if (!fallbackFactory) {
      const { LuaFactory: Factory } = await import("wasmoon");
      fallbackFactory = new Factory();
    }
    return evaluateLuaWithFactory(fallbackFactory, code);
  }

  return new Promise<LuaEvalResult>((resolve) => {
    const w = getWorker();
    const id = nextId++;
    const timer = setTimeout(() => {
      // Kill the worker outright so even tight loops that bypass hooks stop.
      for (const [pid, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(pid);
        entry.resolve({
          output: null,
          error: LUA_TIMEOUT_MSG,
        });
      }
      w.terminate();
      if (worker === w) worker = null;
    }, timeoutMs);

    pending.set(id, { resolve, timer });
    w.postMessage({ id, code });
  });
}
