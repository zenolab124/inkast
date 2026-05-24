import type {
  ListPluginGalleryResponse,
  PluginGalleryItem,
} from "@inkast/shared";

/**
 * Loopback-only feed for the plugin gallery (admin tab). The endpoint sits
 * under `/admin/*`, which is not exposed by the public nginx vhost — works
 * fine here because the entire web UI is loopback only too.
 */
export async function listPluginGallery(limit = 500): Promise<PluginGalleryItem[]> {
  const res = await fetch(`/admin/plugin-gallery.json?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`load plugin gallery failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as ListPluginGalleryResponse;
  return body.items;
}
