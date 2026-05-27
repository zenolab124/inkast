import { Hono } from "hono";
import { requireAuth } from "../../server/middleware/auth.js";
import { RedeemError, redeem } from "./service.js";

export const inviteCodeRoutes = new Hono();

inviteCodeRoutes.post("/topups/invite/redeem", requireAuth, async c => {
  const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return c.json({ error: "code required" }, 400);

  const user = c.get("user");
  try {
    const result = redeem(user.id, code);
    return c.json({
      ok: true,
      amount: result.amount,
      balance_after: result.balanceAfter,
    });
  } catch (err) {
    if (err instanceof RedeemError) {
      const status = err.code === "not_found" ? 404 : 409;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});
