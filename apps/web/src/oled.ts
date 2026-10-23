// Converts the simulator's row-major 1-bit SSD1306 frame (base64) into an image URL.
const cache = new Map<string, string>();
export function oledImage(frame: string) {
  const hit = cache.get(frame);
  if (hit) return hit;
  const bits = Uint8Array.from(atob(frame), (c) => c.charCodeAt(0));
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(128, 64);
  for (let i = 0; i < 8192; i++) {
    const on = bits[i >> 3] & (0x80 >> (i & 7)),
      o = i * 4;
    image.data[o] = on ? 0x9f : 0x0b;
    image.data[o + 1] = on ? 0xe8 : 0x14;
    image.data[o + 2] = on ? 0xff : 0x1c;
    image.data[o + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  if (cache.size > 16) cache.clear();
  cache.set(frame, url);
  return url;
}
