import type { Context, MiddlewareHandler } from "hono";
import { getPluginByToken } from "../../plugins/registry.js";
import type { InkastPlugin } from "../../plugins/types.js";

declare module "hono" {
  interface ContextVariableMap {
    plugin: InkastPlugin;
  }
}

/**
 * Bearer Token 鉴权 + plugin 路由器。匹配成功后把对应的 InkastPlugin 挂到
 * `c.var.plugin`,下游 handler 直接读 `c.get("plugin")`。
 *
 * 失败一律返 OpenAI 风格错误体(`{ error: { code: "unauthorized", ... } }`),
 * 与 plugin 通道其它错误响应同构。
 */
export const pluginAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return rejectAuth(c, "missing or malformed Authorization header");
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    return rejectAuth(c, "empty bearer token");
  }
  const plugin = getPluginByToken(token);
  if (!plugin) {
    return rejectAuth(c, "unknown plugin token");
  }
  c.set("plugin", plugin);
  await next();
};

function rejectAuth(c: Context, message: string) {
  return c.json(
    {
      error: {
        code: "unauthorized",
        message,
        type: "authentication_error",
      },
    },
    401,
  );
}
