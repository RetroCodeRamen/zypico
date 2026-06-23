// PixelScreen — renders a 128×80 indexed framebuffer as chunky, nearest-neighbor
// pixels (plan §4 "nearest-neighbor upscale"; outline §13.1).
//
// The canvas backing store stays at the true 128×80 resolution; CSS stretches it
// to fill the play window with `image-rendering: pixelated`, so the browser does
// the nearest-neighbor upscale for free and the pixels read as chunky. A small
// rAF loop, throttled to `fps`, redraws the scene — companion idle animation
// doesn't need 60 Hz and the T-Deck won't have it to spare.

import { useEffect, useRef } from "react";
import { PixelBuffer, SCREEN_H, SCREEN_W } from "./PixelBuffer.ts";
import { PICO8_RGB, type Rgb } from "./palette.ts";

export interface PixelScreenProps {
  /** Draw one frame into the buffer. `frame` increments each rendered tick. */
  draw: (buf: PixelBuffer, frame: number) => void;
  /** Animation rate; companion scenes idle around 8 fps. */
  fps?: number;
  /** Palette RGB table (defaults to PICO-8). */
  palette?: Rgb[];
  className?: string;
}

export function PixelScreen({ draw, fps = 8, palette = PICO8_RGB, className }: PixelScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest draw fn in a ref so changing it doesn't restart the loop.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const buf = new PixelBuffer(SCREEN_W, SCREEN_H);
    const image = ctx.createImageData(SCREEN_W, SCREEN_H);

    let frame = 0;
    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < interval) return;
      last = t;
      drawRef.current(buf, frame++);
      buf.blitTo(image.data, palette);
      ctx.putImageData(image, 0, 0);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps, palette]);

  return (
    <canvas
      ref={canvasRef}
      width={SCREEN_W}
      height={SCREEN_H}
      className={className}
      // The browser nearest-neighbor-upscales the 128×80 backing store.
      style={{ imageRendering: "pixelated", width: "100%", height: "100%", display: "block" }}
    />
  );
}
