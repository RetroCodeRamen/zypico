// Built-in sample Carts — small Lua programs that demonstrate the sandbox API
// (cls/pset/rectfill/circfill/print/btn, frame, W/H) and the _init/_update/_draw
// lifecycle. These ship in the Exchange so there's something to run/learn from.

export interface SampleCart { name: string; code: string }

export const SAMPLE_CARTS: SampleCart[] = [
  {
    // Move a paddle (SELECT=left, ACCEPT=right) to keep a bouncing ball alive.
    name: "BOUNCER",
    code: `
function _init()
  px = W / 2; bx = W / 2; by = 20; vx = 2; vy = 2; score = 0
end
function _update()
  if btn(0) then px = px - 3 end
  if btn(1) then px = px + 3 end
  if px < 8 then px = 8 end
  if px > W - 8 then px = W - 8 end
  bx = bx + vx; by = by + vy
  if bx < 2 or bx > W - 2 then vx = -vx end
  if by < 2 then vy = -vy end
  if by > H - 8 and bx > px - 9 and bx < px + 9 then vy = -vy; score = score + 1 end
  if by > H then bx = W / 2; by = 20; score = 0 end
end
function _draw()
  cls(1)
  print("BOUNCER " .. score, 2, 2, 7)
  rectfill(px - 8, H - 4, 16, 3, 12)
  circfill(bx, by, 2, 10)
end
`,
  },
  {
    // A drifting starfield; ACCEPT speeds it up. (No interaction needed.)
    name: "STARFIELD",
    code: `
function _init() t = 0 end
function _update() t = t + (btn(1) and 3 or 1) end
function _draw()
  cls(0)
  for i = 1, 24 do
    pset((i * 37 + t * (1 + i % 4)) % W, (i * 53) % H, 7)
  end
  print("STARFIELD", 2, 2, 12)
end
`,
  },
];
