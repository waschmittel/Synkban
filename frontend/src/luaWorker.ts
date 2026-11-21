import { LuaFactory } from "wasmoon";
import wasmUrl from "wasmoon/dist/glue.wasm?url";
import { evaluateLuaWithFactory, type LuaEvalResult } from "./luaEval";

const factory = new LuaFactory(wasmUrl);

interface WorkerRequest {
  id: number;
  code: string;
}

interface WorkerResponse extends LuaEvalResult {
  id: number;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, code } = event.data;
  const result = await evaluateLuaWithFactory(factory, code);
  const reply: WorkerResponse = { id, ...result };
  self.postMessage(reply);
};
