/**
 * SVG → PNG rasterisation, in the page.
 *
 * This runs inside the webview (or a headless smoke-test page) because it needs
 * a real canvas and real font rendering — the same reason the core does. The
 * finished bytes are handed to the host as base64; the webview never touches the
 * filesystem or the clipboard on its own.
 */

export interface RasterResult {
  base64: string;
  width: number;
  height: number;
  /**
   * Sampled pixels that were not fully transparent. A blank render is still a
   * perfectly valid PNG, so this is how the caller can tell "image" from "empty
   * image" — HTML labels inside `<foreignObject>` are the usual offender.
   */
  opaqueSamples: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The rendered SVG could not be loaded as an image.'));
    image.src = url;
  });
}

async function canvasToBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png');
  });
  if (!blob) throw new Error('The canvas could not be encoded as PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Count inked pixels on a downscaled probe, so huge exports stay cheap.
 * Best-effort: a canvas whose pixels cannot be read back (a cross-origin SVG,
 * for instance) still produces a perfectly good PNG, so a failure here must not
 * fail the export — it just reports `-1`.
 */
function countOpaque(canvas: HTMLCanvasElement, maxSide = 160): number {
  try {
    const factor = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * factor));
    const height = Math.max(1, Math.round(canvas.height * factor));
    const probe = document.createElement('canvas');
    probe.width = width;
    probe.height = height;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return -1;
    ctx.drawImage(canvas, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 8) opaque += 1;
    }
    return opaque;
  } catch {
    return -1;
  }
}

/**
 * Rasterise a standalone SVG string at `scale` device pixels per SVG unit.
 *
 * The SVG is handed to `Image` through a **data: URL, not a blob URL**. A blob
 * URL whose SVG contains `<foreignObject>` — which mermaid always emits for its
 * HTML labels — makes Chromium mark the canvas as tainted, so the export throws
 * "Tainted canvases may not be exported". A data: URL stays same-origin and the
 * PNG comes out clean. Transparency is still preserved: a diagram without a
 * canvas colour leaves the canvas untouched.
 */
export async function rasteriseSvg(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<RasterResult> {
  const factor = clamp(Number.isFinite(scale) ? scale : 1, 1, 4);
  const targetWidth = Math.max(1, Math.round((width || 1) * factor));
  const targetHeight = Math.max(1, Math.round((height || 1) * factor));

  const bytes = new TextEncoder().encode(svg);
  const dataUrl = `data:image/svg+xml;base64,${bytesToBase64(bytes)}`;

  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context available for the PNG export.');
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const opaqueSamples = countOpaque(canvas);
  const png = await canvasToBytes(canvas);
  return { base64: bytesToBase64(png), width: targetWidth, height: targetHeight, opaqueSamples };
}
