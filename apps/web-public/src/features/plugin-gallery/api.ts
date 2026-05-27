import type { ListPluginGalleryResponse } from "@inkast/shared";

/**
 * Loopback-only feed for the plugin gallery (admin tab). The endpoint sits
 * under `/admin/*`, which is not exposed by the public nginx vhost — works
 * fine here because the entire web UI is loopback only too.
 *
 * Keyset pagination: pass the `nextCursor` returned from the previous page to
 * get the next slice; `null` means no more rows.
 */
export interface FetchPluginGalleryArgs {
  cursor?: string | null;
  limit?: number;
  pluginId?: string | null;
}

export async function fetchPluginGallery(
  args: FetchPluginGalleryArgs = {},
): Promise<ListPluginGalleryResponse> {
  const params = new URLSearchParams();
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.limit) params.set("limit", String(args.limit));
  if (args.pluginId) params.set("pluginId", args.pluginId);
  const qs = params.toString();
  const url = qs ? `/admin/plugin-gallery.json?${qs}` : `/admin/plugin-gallery.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`load plugin gallery failed: HTTP ${res.status}`);
  }
  return (await res.json()) as ListPluginGalleryResponse;
}
