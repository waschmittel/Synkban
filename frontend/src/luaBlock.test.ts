import { describe, it, expect } from "vitest";
import { hashLuaCode, runLua } from "./luaRunner";
import { luaCompletionsAt, tokenizeLua } from "./luaSyntax";

describe("hashLuaCode", () => {
  it("produces deterministic 8-char hex hashes", () => {
    expect(hashLuaCode("return 1 + 2")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashLuaCode("return 1 + 2")).toBe(hashLuaCode("return 1 + 2"));
    expect(hashLuaCode("return 1 + 2")).not.toBe(hashLuaCode("return 1 + 3"));
  });
});

describe("tokenizeLua", () => {
  it("classifies keywords, builtins, stdlib members, strings, numbers, and comments", () => {
    const code = [
      "-- compute total",
      "local sum = math.sqrt(16) + 0x10",
      'print("ok", sum)',
    ].join("\n");
    const tokens = tokenizeLua(code);
    const kind = (text: string) => tokens.find((t) => t.text === text)?.type;
    expect(kind("-- compute total")).toBe("comment");
    expect(kind("local")).toBe("keyword");
    expect(kind("sum")).toBe("ident");
    expect(kind("math")).toBe("builtin");
    expect(kind("sqrt")).toBe("builtin");
    expect(kind("16")).toBe("number");
    expect(kind("0x10")).toBe("number");
    expect(kind("print")).toBe("builtin");
    expect(kind('"ok"')).toBe("string");
  });

  it("handles long brackets for strings and block comments", () => {
    const code = "--[[ multi\nline ]] local s = [[hello]]";
    const tokens = tokenizeLua(code);
    expect(tokens[0]).toMatchObject({ type: "comment", text: "--[[ multi\nline ]]", closed: true });
    expect(tokens.find((t) => t.text === "[[hello]]")).toMatchObject({ type: "string", closed: true });
  });
});

describe("luaCompletionsAt", () => {
  it("completes stdlib members right after module dot", () => {
    const code = "local r = math.sq";
    const res = luaCompletionsAt(code, code.length)!;
    expect(res).not.toBeNull();
    expect(code.slice(res.from, res.to)).toBe("sq");
    expect(res.items.map((i) => i.label)).toEqual(["sqrt"]);

    const allMath = luaCompletionsAt("math.", 5)!;
    expect(allMath.items.some((i) => i.label === "floor")).toBe(true);
    expect(allMath.items.some((i) => i.label === "pi")).toBe(true);
  });

  it("completes local variables, builtins, and keywords after 2+ chars", () => {
    const code = "local seat_price = 19\nlocal total = se";
    const res = luaCompletionsAt(code, code.length)!;
    expect(res.items[0]).toMatchObject({ label: "seat_price", kind: "local" });
    expect(res.items.some((i) => i.label === "select" && i.kind === "builtin")).toBe(true);

    expect(luaCompletionsAt("local x = r", 11)).toBeNull();
  });

  it("ignores the identifier at caret, new declaration names, and complete keywords", () => {
    // Naming a variable must not complete `local ta` onto itself.
    expect(luaCompletionsAt("local ta", 8)).toBeNull();
    expect(luaCompletionsAt("local function fo", 17)).toBeNull();
    expect(luaCompletionsAt("for id", 6)).toBeNull();
    // Complete keywords (e.g. `else`, `return`, `do`) must dismiss cleanly.
    expect(luaCompletionsAt("if x then\nelse", 14)).toBeNull();
    expect(luaCompletionsAt("return", 6)).toBeNull();
    // Once declared earlier, referencing `ta` completes `tab`.
    const ref = luaCompletionsAt("local tab = 1\nreturn ta", 23)!;
    expect(ref.items[0]).toMatchObject({ label: "tab", kind: "local" });
  });

  it("suppresses completion inside strings and comments", () => {
    expect(luaCompletionsAt('local s = "math.', 16)).toBeNull();
    expect(luaCompletionsAt("-- math.sq", 10)).toBeNull();
  });
});

describe("runLua (wasmoon sandbox)", () => {
  it("evaluates bare expressions and multi-statement blocks with print", async () => {
    expect(await runLua("1 + 2 * 3")).toEqual({ output: "=> 7", error: null });

    const multi = await runLua('local t = { 10, 20, 30 }\nprint("items:", t)\nreturn #t');
    expect(multi).toEqual({
      output: "items:\t{ 10, 20, 30 }\n=> 3",
      error: null,
    });
  });

  it("reports syntax and runtime errors cleanly", async () => {
    const syn = await runLua("local x = (1 + 2");
    expect(syn.output).toBeNull();
    expect(syn.error).toMatch(/expected|syntax/i);

    const rt = await runLua('print("before")\nerror("boom")');
    expect(rt.output).toBe("before");
    expect(rt.error).toContain("boom");
  });

  it("strips unsafe standard libraries and blocks binary load", async () => {
    const sandbox = await runLua(
      "return io == nil, package == nil, require == nil, debug == nil, dofile == nil, loadfile == nil, os.execute == nil",
    );
    expect(sandbox).toEqual({
      output: "=> true, true, true, true, true, true, true",
      error: null,
    });

    const osRead = await runLua('return type(os.time()), type(os.date("%Y"))');
    expect(osRead).toEqual({ output: "=> number, string", error: null });

    const bytecode = await runLua('local fn, err = load("\\27Lua", "x", "bt"); return fn == nil, type(err)');
    expect(bytecode).toEqual({ output: "=> true, string", error: null });
  });

  it("aborts infinite loops via the instruction-count hook", async () => {
    const res = await runLua('print("start")\nwhile true do end');
    expect(res.output).toBe("start");
    expect(res.error).toContain("timed out");
  });
});
