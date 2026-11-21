import type { LuaFactory } from "wasmoon";

export interface LuaEvalResult {
  output: string | null;
  error: string | null;
}

const MAX_OUTPUT_CHARS = 8192;
const MAX_MEMORY_BYTES = 16 * 1024 * 1024;
export const LUA_TIMEOUT_MSG = "Execution timed out (1.5s limit)";

/// Deterministic 32-bit FNV-1a hex hash over UTF-16 code units.
/// Matches `backend/src/pdf.rs::fnv1a_32_hex` so stale-output detection agrees
/// between the frontend editor and server-side PDF export.
export function hashLuaCode(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const LUA_HARNESS = `
local _code = __user_code
__user_code = nil

local _sethook = debug and debug.sethook
local _load = load
local _pcall = pcall
local _tostring = tostring
local _type = type
local _pairs = pairs
local _ipairs = ipairs
local _unpack = table.unpack
local _pack = table.pack
local _concat = table.concat
local _sort = table.sort
local _getmetatable = getmetatable
local _floor = math.floor

io = nil
package = nil
require = nil
debug = nil
dofile = nil
loadfile = nil
os = {
  clock = os and os.clock,
  date = os and os.date,
  difftime = os and os.difftime,
  time = os and os.time,
}
load = function(chunk, chunkname, _mode, env)
  if env == nil then return _load(chunk, chunkname, "t") end
  return _load(chunk, chunkname, "t", env)
end

local MAX_BYTES = ${MAX_OUTPUT_CHARS}
local __out = {}
local __out_len = 0
local __truncated = false
local __timed_out = false

local function __append_line(line)
  if __truncated then return end
  local add = #line + (#__out > 0 and 1 or 0)
  if __out_len + add > MAX_BYTES then
    local room = MAX_BYTES - __out_len - (#__out > 0 and 1 or 0)
    if room > 0 then
      __out[#__out + 1] = line:sub(1, room)
    end
    __out[#__out + 1] = "... (truncated)"
    __truncated = true
    return
  end
  __out[#__out + 1] = line
  __out_len = __out_len + add
end

local function __fmt(v, depth, seen)
  local t = _type(v)
  if t == "string" then
    if depth > 0 then return string.format("%q", v) end
    return v
  end
  if t ~= "table" then return _tostring(v) end
  local mt = _getmetatable(v)
  if mt and mt.__tostring then return _tostring(v) end
  if depth >= 2 then return _tostring(v) end
  if seen[v] then return "{...}" end
  seen[v] = true

  local count = 0
  local is_array = true
  local max_i = 0
  for k in _pairs(v) do
    count = count + 1
    if _type(k) ~= "number" or k < 1 or _floor(k) ~= k then
      is_array = false
    elseif k > max_i then
      max_i = k
    end
  end
  if is_array and max_i ~= count then is_array = false end

  local parts = {}
  local limit = 20
  if is_array then
    for i = 1, count do
      if i > limit then
        parts[#parts + 1] = "..."
        break
      end
      parts[#parts + 1] = __fmt(v[i], depth + 1, seen)
    end
  else
    local keys = {}
    for k in _pairs(v) do keys[#keys + 1] = k end
    _sort(keys, function(a, b) return _tostring(a) < _tostring(b) end)
    for i = 1, #keys do
      if i > limit then
        parts[#parts + 1] = "..."
        break
      end
      local k = keys[i]
      local ks = _type(k) == "string" and k:match("^[A-Za-z_][A-Za-z0-9_]*$") and k or ("[" .. __fmt(k, depth + 1, seen) .. "]")
      parts[#parts + 1] = ks .. " = " .. __fmt(v[k], depth + 1, seen)
    end
  end
  seen[v] = nil
  if #parts == 0 then return "{}" end
  return "{ " .. _concat(parts, ", ") .. " }"
end

print = function(...)
  local n = select("#", ...)
  local parts = {}
  for i = 1, n do
    parts[i] = __fmt(select(i, ...), 0, {})
  end
  __append_line(_concat(parts, "\\t"))
end

if _code:match("^%s*$") then
  return { output = "", error = nil }
end

local expr_fn = _load("return " .. _code, "=[lua_block]", "t")
local stmt_fn, stmt_err = _load(_code, "=[lua_block]", "t")
local fn = expr_fn or stmt_fn
if not fn then
  return { output = nil, error = _tostring(stmt_err) }
end

if _sethook then
  _sethook(function()
    __timed_out = true
    error("${LUA_TIMEOUT_MSG}", 2)
  end, "", 1000000)
end

local res = _pack(_pcall(fn))

if _sethook then
  _sethook()
end

if __timed_out or not res[1] then
  local partial = #__out > 0 and _concat(__out, "\\n") or nil
  local err = __timed_out and "${LUA_TIMEOUT_MSG}" or _tostring(res[2])
  return { output = partial, error = err }
end

if res.n > 1 and (not stmt_fn or res.n > 2 or res[2] ~= nil) then
  local ret_parts = {}
  for i = 2, res.n do
    ret_parts[#ret_parts + 1] = __fmt(res[i], 0, {})
  end
  __append_line("=> " .. _concat(ret_parts, ", "))
end

return { output = _concat(__out, "\\n"), error = nil }
`;

/// Evaluates a single Lua 5.4 snippet in a fresh, sandboxed `wasmoon` engine.
export async function evaluateLuaWithFactory(
  factory: LuaFactory,
  code: string,
): Promise<LuaEvalResult> {
  const lua = await factory.createEngine({
    openStandardLibs: true,
    injectObjects: false,
    traceAllocations: true,
  });
  try {
    lua.global.setMemoryMax(MAX_MEMORY_BYTES);
    lua.global.set("__user_code", code);
    const res = (await lua.doString(LUA_HARNESS)) as
      | { output?: string; error?: string }
      | undefined;
    return {
      output: typeof res?.output === "string" ? res.output : null,
      error: typeof res?.error === "string" ? res.error : null,
    };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    lua.global.close();
  }
}
