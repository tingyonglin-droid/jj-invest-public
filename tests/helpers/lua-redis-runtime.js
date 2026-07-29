import lua from "fengari/src/lua.js";
import fengariCore from "fengari/src/fengaricore.js";
import lauxlib from "fengari/src/lauxlib.js";
import lbaselib from "fengari/src/lbaselib.js";

const { to_luastring: toLuaString } = fengariCore;

const JSON_NULL = Object.freeze({ type: "json-null" });
const JSON_KIND = toLuaString("__json_kind", true);

function luaError(L, prefix) {
  const detail = lua.lua_tojsstring(L, -1) || "unknown Lua error";
  return new Error(`${prefix}: ${detail}`);
}

function setJsonKind(L, kind) {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, kind);
  lua.lua_setfield(L, -2, JSON_KIND);
  lua.lua_setmetatable(L, -2);
}

function pushLuaValue(L, value) {
  if (value === undefined || value === null) {
    lua.lua_pushnil(L);
    return;
  }
  if (value === JSON_NULL) {
    lua.lua_pushlightuserdata(L, JSON_NULL);
    return;
  }
  if (typeof value === "string") {
    lua.lua_pushliteral(L, value);
    return;
  }
  if (typeof value === "boolean") {
    lua.lua_pushboolean(L, value);
    return;
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) {
      lua.lua_pushinteger(L, value);
    } else {
      lua.lua_pushnumber(L, value);
    }
    return;
  }
  if (Array.isArray(value)) {
    lua.lua_createtable(L, value.length, 0);
    value.forEach((item, index) => {
      pushLuaValue(L, item === null ? JSON_NULL : item);
      lua.lua_rawseti(L, -2, index + 1);
    });
    setJsonKind(L, "array");
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    lua.lua_createtable(L, 0, entries.length);
    for (const [key, item] of entries) {
      pushLuaValue(L, item === null ? JSON_NULL : item);
      lua.lua_setfield(L, -2, toLuaString(key));
    }
    setJsonKind(L, "object");
    return;
  }
  throw new TypeError(`Unsupported Lua boundary value: ${typeof value}`);
}

function tableJsonKind(L, index) {
  const absoluteIndex = lua.lua_absindex(L, index);
  if (!lua.lua_getmetatable(L, absoluteIndex)) return null;
  lua.lua_getfield(L, -1, JSON_KIND);
  const kind = lua.lua_type(L, -1) === lua.LUA_TSTRING
    ? lua.lua_tojsstring(L, -1)
    : null;
  lua.lua_pop(L, 2);
  return kind;
}

function readLuaValue(L, index) {
  switch (lua.lua_type(L, index)) {
    case lua.LUA_TNIL:
      return null;
    case lua.LUA_TBOOLEAN:
      return Boolean(lua.lua_toboolean(L, index));
    case lua.LUA_TNUMBER:
      return lua.lua_isinteger(L, index)
        ? lua.lua_tointeger(L, index)
        : lua.lua_tonumber(L, index);
    case lua.LUA_TSTRING:
      return lua.lua_tojsstring(L, index);
    case lua.LUA_TLIGHTUSERDATA:
      return lua.lua_touserdata(L, index) === JSON_NULL ? JSON_NULL : null;
    case lua.LUA_TTABLE: {
      const absoluteIndex = lua.lua_absindex(L, index);
      const kind = tableJsonKind(L, absoluteIndex);
      const entries = [];
      lua.lua_pushnil(L);
      while (lua.lua_next(L, absoluteIndex) !== 0) {
        entries.push([
          readLuaValue(L, -2),
          readLuaValue(L, -1),
        ]);
        lua.lua_pop(L, 1);
      }
      const numericKeys = entries.every(([key]) => Number.isInteger(key) && key >= 1);
      if (kind === "array" || (!kind && numericKeys)) {
        const result = [];
        for (const [key, value] of entries) result[key - 1] = value === JSON_NULL ? null : value;
        return result;
      }
      return Object.fromEntries(entries.map(([key, value]) => [
        String(key),
        value === JSON_NULL ? null : value,
      ]));
    }
    default:
      throw new TypeError(`Unsupported Lua result type: ${lua.lua_typename(L, lua.lua_type(L, index))}`);
  }
}

function installArrayGlobal(L, name, values) {
  lua.lua_createtable(L, values.length, 0);
  values.forEach((value, index) => {
    pushLuaValue(L, String(value));
    lua.lua_rawseti(L, -2, index + 1);
  });
  lua.lua_setglobal(L, toLuaString(name, true));
}

function installRedisGlobal(L, callRedis) {
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, (state) => {
    try {
      const argumentCount = lua.lua_gettop(state);
      const rawCommand = readLuaValue(state, 1);
      if (typeof rawCommand !== "string") {
        throw new TypeError("Lua redis lib command arguments must be strings or integers");
      }
      const command = rawCommand.toUpperCase();
      const args = [];
      for (let index = 2; index <= argumentCount; index += 1) {
        const value = readLuaValue(state, index);
        if (typeof value !== "string"
          && !(typeof value === "number" && Number.isSafeInteger(value))) {
          throw new TypeError("Lua redis lib command arguments must be strings or integers");
        }
        args.push(value);
      }
      pushLuaValue(state, callRedis(command, args));
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(
        state,
        toLuaString(error instanceof Error ? error.message : String(error)),
      );
    }
  });
  lua.lua_setfield(L, -2, toLuaString("call", true));
  lua.lua_setglobal(L, toLuaString("redis", true));
}

function installCjsonGlobal(L) {
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, (state) => {
    try {
      const parsed = JSON.parse(String(readLuaValue(state, 1)));
      pushLuaValue(state, parsed === null ? JSON_NULL : parsed);
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(
        state,
        toLuaString(`cjson.decode failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  });
  lua.lua_setfield(L, -2, toLuaString("decode", true));
  lua.lua_pushjsfunction(L, (state) => {
    try {
      const value = readLuaValue(state, 1);
      lua.lua_pushliteral(state, JSON.stringify(value === JSON_NULL ? null : value));
      return 1;
    } catch (error) {
      return lauxlib.luaL_error(
        state,
        toLuaString(`cjson.encode failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    }
  });
  lua.lua_setfield(L, -2, toLuaString("encode", true));
  lua.lua_pushlightuserdata(L, JSON_NULL);
  lua.lua_setfield(L, -2, toLuaString("null", true));
  lua.lua_setglobal(L, toLuaString("cjson", true));
}

export function executeRedisLua({ script, keys, args, callRedis }) {
  const L = lauxlib.luaL_newstate();
  try {
    lbaselib.luaopen_base(L);
    lua.lua_pop(L, 1);
    installArrayGlobal(L, "KEYS", keys);
    installArrayGlobal(L, "ARGV", args);
    installRedisGlobal(L, callRedis);
    installCjsonGlobal(L);

    const loadStatus = lauxlib.luaL_loadstring(L, toLuaString(String(script)));
    if (loadStatus !== lua.LUA_OK) throw luaError(L, "Lua syntax error");
    const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
    if (callStatus !== lua.LUA_OK) throw luaError(L, "Lua execution error");

    const resultCount = lua.lua_gettop(L);
    if (resultCount === 0) return null;
    if (resultCount === 1) return readLuaValue(L, 1);
    return Array.from({ length: resultCount }, (_, index) => readLuaValue(L, index + 1));
  } finally {
    lua.lua_close(L);
  }
}
