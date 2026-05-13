import { Hono } from "hono";
import { cors } from "hono/cors";
import { promptRoutes } from "./routes/prompt.js";
import { providerRoutes } from "./routes/providers.js";
import { generateRoutes } from "./routes/generate.js";
import { db } from "../storage/db.js";

export function createApp() {
  // Touch the DB to apply schema before serving any request.
  db();

  const app = new Hono();

  app.use("*", cors());

  app.get("/api/health", c =>
    c.json({ status: "ok", service: "inkast-api", version: "0.0.1" }),
  );

  app.route("/api", promptRoutes);
  app.route("/api", providerRoutes);
  app.route("/api", generateRoutes);

  return app;
}
