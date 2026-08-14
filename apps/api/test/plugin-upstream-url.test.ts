import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedUpstreamImageUrl } from "../src/domain/plugin-async/upstream-url.js";

const ALLOWED = ["https://img.124213.xyz"];

test("plugin upstream URL passthrough requires an explicitly allowed exact HTTPS origin", () => {
  assert.equal(
    isAllowedUpstreamImageUrl(
      "https://img.124213.xyz/2026/08/result.webp?version=1",
      ALLOWED,
    ),
    true,
  );
  assert.equal(isAllowedUpstreamImageUrl("https://img.124213.xyz/result.webp", undefined), false);
  assert.equal(isAllowedUpstreamImageUrl("http://img.124213.xyz/result.webp", ALLOWED), false);
  assert.equal(isAllowedUpstreamImageUrl("https://img.124213.xyz.evil.test/result.webp", ALLOWED), false);
  assert.equal(isAllowedUpstreamImageUrl("https://user:pass@img.124213.xyz/result.webp", ALLOWED), false);
  assert.equal(isAllowedUpstreamImageUrl("not a URL", ALLOWED), false);
});
