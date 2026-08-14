/**
 * Decide whether a provider-owned image URL may be returned directly to a
 * plugin caller. The allowlist is opt-in per plugin and matches exact HTTPS
 * origins so temporary URLs from unrelated fallback providers never leak into
 * the long-lived callback contract.
 */
export function isAllowedUpstreamImageUrl(
  imageUrl: string | undefined,
  allowedOrigins: readonly string[] | undefined,
): imageUrl is string {
  if (!imageUrl || !allowedOrigins?.length) return false;

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return false;
    }
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}
