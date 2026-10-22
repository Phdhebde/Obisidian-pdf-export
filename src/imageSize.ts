/*
 * Intrinsic size of an image, read from its bytes.
 *
 * Pure, with no Obsidian import, so the Word engine can size a picture under
 * Node in the tests as well as in the plugin.
 */

/** Intrinsic pixel size read straight from PNG / GIF / JPEG bytes. */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
    // PNG: IHDR width/height are big-endian at bytes 16..23. Read unsigned —
    // `<< 24` would go negative on images wider than 32767 px.
    const rd = (o: number) => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
    return { w: rd(16), h: rd(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) }; // GIF
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2; // JPEG: walk the marker chain to the SOF segment
    while (i < b.length - 8) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1];
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
        return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}
