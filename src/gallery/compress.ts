// Gzip round-trip for gallery blobs, using the browser-native
// CompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+ — and Node
// 18+, which is why the tests can run in vitest without polyfills).
// Blueprints compress ~16× (observed: 253KB calibration → 16KB, 29MB tower
// → ~1.8MB), which is what makes the 1GB free storage tier hold thousands
// of bases (docs/GALLERY.md).

export async function gzipText(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

export async function gunzipToText(data: Blob): Promise<string> {
  const stream = data.stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
