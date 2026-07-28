import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { Agent, setGlobalDispatcher } from "undici";

/**
 * Widen Node's Happy Eyeballs (RFC 8305) per-address handshake window.
 *
 * Node 18.13+ enables `autoSelectFamily` by default and gives each candidate
 * address only 250ms to complete its TCP handshake. jdc → Cloudflare measures
 * 305ms and 443ms for the two R2 endpoint IPs — every candidate blows the
 * default window, so a *cold* connection fails ~60% of the time with a bare
 * `ETIMEDOUT` (name `TimeoutError`, empty message). Warm sockets skip the
 * handshake entirely, which is why this only ever surfaced on the rarely-taken
 * R2 upload path: the common case returns an upstream URL and never uploads.
 *
 * Confirmed by bisection: raw `https.request` to the same endpoint succeeds
 * 5/5 (one taking 2321ms — slower than the SDK's 1.7s failure, so latency was
 * never the problem), and `--no-network-family-autoselection` turns 3-of-5
 * failures into 8-of-8 successes.
 *
 * 1000ms covers the observed handshake range with headroom while keeping
 * dual-stack fallback semantics intact. Process-wide on purpose: every
 * upstream we talk to is cross-border and shares the same latency floor.
 */
setDefaultAutoSelectFamilyAttemptTimeout(1_000);

/**
 * Configure Node's global fetch dispatcher with timings tuned for long-running
 * image generation calls through high-latency CDN-fronted proxies.
 *
 * Why this exists:
 *   undici's defaults (`headersTimeout: 300_000`, `bodyTimeout: 300_000`) cut
 *   long-running image generation streams off at 5 minutes. Some providers
 *   route through multi-hop Akamai/cache networks (HK → JP → US) and routinely
 *   spend 4+ minutes in queue before sending response headers — at default
 *   settings these requests die with `UND_ERR_HEADERS_TIMEOUT` regardless of
 *   our driver-level 10-minute abort. We align undici with the driver budget.
 *
 * Trade-offs:
 *   - Silent peer death is now detected at 10 min instead of 5 (acceptable;
 *     fast-fail cases — DNS / RST / refused — surface in seconds via
 *     `connectTimeout: 30s` regardless).
 *   - All `fetch` in this Node process now uses these timings. Today that
 *     means our two image drivers + the URL-image fallback in the
 *     openai-compatible driver, which is exactly what we want.
 *
 * This is a module-level side-effect: importing this file once at startup is
 * enough. We call it from the server entry to guarantee it runs before any
 * generation job kicks off.
 */
setGlobalDispatcher(
  new Agent({
    /** TCP connect must complete fast — Class-A failures (DNS / RST / refused). */
    connectTimeout: 30_000,
    /** Time from socket-established to first response byte. CDN queue lives here. */
    headersTimeout: 600_000,
    /** Inter-event idle window inside a stream. SSE-mode lives here. */
    bodyTimeout: 600_000,
    /** Keep idle sockets briefly so retry-after-failure isn't penalized. */
    keepAliveTimeout: 60_000,
  }),
);
