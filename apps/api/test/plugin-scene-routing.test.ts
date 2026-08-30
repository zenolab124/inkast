import assert from "node:assert/strict";
import test from "node:test";

import { canAccessPluginTask, resolvePluginScene } from "../src/server/routes/plugins.js";
import type { InkastPlugin } from "../src/plugins/types.js";

const logoPlugin: InkastPlugin = {
  id: "snapub_logo",
  name: "SNAP-UB logo",
  imageDefaults: { format: "png" },
};

const snapubPlugin: InkastPlugin = {
  id: "snapub",
  name: "SNAP-UB",
  imageDefaults: { format: "webp" },
  scenePlugins: { diy_logo: "snapub_logo" },
};

test("scene delegation resolves an allowlisted output plugin under the base token", () => {
  const result = resolvePluginScene(
    snapubPlugin,
    "diy_logo",
    id => (id === logoPlugin.id ? logoPlugin : undefined),
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plugin.id, "snapub_logo");
});

test("missing scene preserves the authenticated plugin", () => {
  const result = resolvePluginScene(snapubPlugin, undefined, () => undefined);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.plugin.id, "snapub");
});

test("caller cannot select an unconfigured scene or raw plugin id", () => {
  for (const scene of ["admin", "snapub_logo", "../snapub_logo"]) {
    const result = resolvePluginScene(snapubPlugin, scene, () => logoPlugin);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
  }
});

test("configured scene fails closed when its target overlay is unavailable", () => {
  const result = resolvePluginScene(snapubPlugin, "diy_logo", () => undefined);
  assert.deepEqual(result, {
    ok: false,
    status: 503,
    code: "plugin_misconfigured",
    message: "configured scene plugin is unavailable",
  });
});

test("base token can poll base and delegated tasks but no unrelated plugin", () => {
  assert.equal(canAccessPluginTask(snapubPlugin, "snapub"), true);
  assert.equal(canAccessPluginTask(snapubPlugin, "snapub_logo"), true);
  assert.equal(canAccessPluginTask(snapubPlugin, "mpinkast"), false);
});
