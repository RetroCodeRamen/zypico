// Built-in Carts — small Lua programs that double as the Arcade's games and as
// examples of the sandbox API. Drawing: cls/pset/pget/line/rect/rectfill/circ/
// circfill/print/spr. Input: btn(b) (held ~160ms) + btnp(b) (rising edge);
// 0=SELECT 1=ACCEPT 2=CANCEL. Sound: beep(freq,dur,wave). Plus W/H/frame, flr,
// rnd, and the Lua math/string/table libs. Lifecycle: _init/_update/_draw.

export interface SampleCart { name: string; code: string }

export const SAMPLE_CARTS: SampleCart[] = [
  {
    // A tour of the graphics + input + sound API (study it in the Workshop).
    name: "DEMO",
    code: `
-- API DEMO: shapes, a sprite, btnp + beep
hero = {
  ".88.",
  "8888",
  "8.8.",
}
function _init() x = 56 end
function _update()
  if btnp(0) then x = x - 8; beep(440, 0.05) end
  if btnp(1) then x = x + 8; beep(660, 0.05) end
end
function _draw()
  cls(1)
  print("BTNP MOVES + BEEPS", 2, 2, 7)
  line(0, 22, W, 22, 5)
  rect(8, 28, 40, 28, 12)
  circ(96, 44, 14, 11)
  circfill(96, 44, 6, 10)
  spr(x, 60, hero, 3)
end
`,
  },
  {
    // Mini Breakout: paddle (SELECT=left, ACCEPT=right), clear the brick wall.
    // 3 lives, win when the wall is gone; ACCEPT restarts on win/lose.
    name: "BREAKOUT",
    code: `
function _init()
  px = W / 2
  bx = W / 2; by = H / 2; vx = 1.4; vy = 1.6
  cols = 7; rows = 3
  bw = flr((W - 4) / cols)
  bricks = {}
  for r = 1, rows do bricks[r] = {} for c = 1, cols do bricks[r][c] = 1 end end
  alive = rows * cols
  score = 0; lives = 3; state = 0 -- 0 play, 1 win, 2 lose
end
function _update()
  if state ~= 0 then
    if btn(1) then _init() end
    return
  end
  if btn(0) then px = px - 4 end
  if btn(1) then px = px + 4 end
  if px < 8 then px = 8 end
  if px > W - 8 then px = W - 8 end
  bx = bx + vx; by = by + vy
  if bx < 2 then bx = 2; vx = -vx end
  if bx > W - 2 then bx = W - 2; vx = -vx end
  if by < 10 then by = 10; vy = -vy end
  if by > H - 6 and bx > px - 9 and bx < px + 9 then
    vy = -vy; by = H - 6
    vx = vx + (bx - px) * 0.04 -- english off the paddle
  end
  if by > H then
    lives = lives - 1; bx = W / 2; by = H / 2; vy = -1.6; vx = 1.4
    if lives <= 0 then state = 2 end
  end
  for r = 1, rows do
    local brow = 12 + (r - 1) * 5
    for c = 1, cols do
      if bricks[r][c] == 1 then
        local bxl = 2 + (c - 1) * bw
        if by > brow - 1 and by < brow + 5 and bx > bxl and bx < bxl + bw - 1 then
          bricks[r][c] = 0; alive = alive - 1; vy = -vy; score = score + 1
          if alive <= 0 then state = 1 end
        end
      end
    end
  end
end
function _draw()
  cls(0)
  print("BREAKOUT " .. score, 2, 2, 7)
  print("X" .. lives, W - 14, 2, 8)
  for r = 1, rows do
    local brow = 12 + (r - 1) * 5
    for c = 1, cols do
      if bricks[r][c] == 1 then rectfill(2 + (c - 1) * bw, brow, bw - 1, 4, 8 + r) end
    end
  end
  rectfill(px - 8, H - 4, 16, 3, 12)
  circfill(bx, by, 2, 10)
  if state == 1 then print("YOU WIN! ACCEPT=AGAIN", 6, H / 2, 11) end
  if state == 2 then print("GAME OVER ACCEPT=RETRY", 4, H / 2, 8) end
end
`,
  },
  {
    // Tic-Tac-Toe vs a simple CPU: SELECT moves the cursor, ACCEPT places. The
    // CPU wins/blocks/takes-centre, else plays random. ACCEPT restarts at the end.
    name: "TICTACTOE",
    code: `
function _init()
  b = { 0, 0, 0, 0, 0, 0, 0, 0, 0 } -- 0 empty, 1 you (X), 2 cpu (O)
  cur = 1; turn = 1; state = 0; cd = 0 -- state: 0 play,1 you,2 cpu,3 draw
  pb0 = false; pb1 = false
end
function winner()
  local L = { {1,2,3},{4,5,6},{7,8,9},{1,4,7},{2,5,8},{3,6,9},{1,5,9},{3,5,7} }
  for i = 1, 8 do
    local a, c, d = L[i][1], L[i][2], L[i][3]
    if b[a] ~= 0 and b[a] == b[c] and b[a] == b[d] then return b[a] end
  end
  return 0
end
function full()
  for i = 1, 9 do if b[i] == 0 then return false end end
  return true
end
function cpumove()
  for i = 1, 9 do if b[i] == 0 then b[i] = 2; if winner() == 2 then return end; b[i] = 0 end end
  for i = 1, 9 do if b[i] == 0 then b[i] = 1; if winner() == 1 then b[i] = 2; return end; b[i] = 0 end end
  if b[5] == 0 then b[5] = 2; return end
  local opts = {}
  for i = 1, 9 do if b[i] == 0 then opts[#opts + 1] = i end end
  if #opts > 0 then b[opts[flr(rnd(#opts)) + 1]] = 2 end
end
function _update()
  local s0, s1 = btn(0), btn(1)
  if state ~= 0 then
    if s1 and not pb1 then _init() end
    pb0 = s0; pb1 = s1; return
  end
  if turn == 1 then
    if s0 and not pb0 then cur = cur + 1; if cur > 9 then cur = 1 end end
    if s1 and not pb1 and b[cur] == 0 then
      b[cur] = 1
      if winner() == 1 then state = 1 elseif full() then state = 3 else turn = 2; cd = 8 end
    end
  else
    cd = cd - 1
    if cd <= 0 then
      cpumove()
      if winner() == 2 then state = 2 elseif full() then state = 3 else turn = 1 end
    end
  end
  pb0 = s0; pb1 = s1
end
function _draw()
  cls(1)
  print("TIC-TAC-TOE", 2, 2, 7)
  local ox, oy, cs = 44, 14, 18
  for i = 1, 2 do
    rectfill(ox + i * cs, oy, 1, cs * 3, 6)
    rectfill(ox, oy + i * cs, cs * 3, 1, 6)
  end
  for i = 1, 9 do
    local r = flr((i - 1) / 3); local c = (i - 1) % 3
    local x = ox + c * cs; local y = oy + r * cs
    if b[i] == 1 then print("X", x + 7, y + 7, 10)
    elseif b[i] == 2 then print("O", x + 7, y + 7, 12) end
    if turn == 1 and state == 0 and i == cur then
      rectfill(x + 1, y + 1, cs - 2, 1, 9)
      rectfill(x + 1, y + cs - 2, cs - 2, 1, 9)
      rectfill(x + 1, y + 1, 1, cs - 2, 9)
      rectfill(x + cs - 2, y + 1, 1, cs - 2, 9)
    end
  end
  if state == 1 then print("YOU WIN! ACCEPT=AGAIN", 6, H - 8, 11) end
  if state == 2 then print("CPU WINS ACCEPT=AGAIN", 6, H - 8, 8) end
  if state == 3 then print("DRAW! ACCEPT=AGAIN", 12, H - 8, 7) end
end
`,
  },
];
