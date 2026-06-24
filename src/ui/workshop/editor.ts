// The on-LCD Lua code editor's text model (pure + DOM-free so it unit-tests in
// isolation). The buffer is a single string with a caret index; the renderer
// (scenes/render.ts) lays it out as lines on the matrix. Lua is case-sensitive,
// so the buffer preserves real case — only the pixel font displays it in caps.

/** The skeleton a NEW cart starts from (REDESIGN §Making). */
export const CART_TEMPLATE = `-- MY CART
function _init()
end

function _update()
end

function _draw()
  cls(1)
  print("HELLO", 2, 2, 7)
end
`;

/** A cart being edited. origName = the saved name it was opened from (null = new). */
export interface CartDoc {
  name: string;
  code: string;
  caret: number;
  dirty: boolean;
  origName: string | null;
}

// CART name/code wire limits (encodeCart: 1-byte name length, 2-byte code length).
// We cap code well under the wire max so a cart always fits + fragments cleanly.
export const NAME_MAX = 16;
export const CODE_MAX = 4096;

function clamp(code: string, caret: number): number {
  return Math.max(0, Math.min(code.length, caret));
}

export function insertAt(code: string, caret: number, s: string): { code: string; caret: number } {
  const c = clamp(code, caret);
  if (code.length + s.length > CODE_MAX) return { code, caret: c }; // refuse past the cap
  return { code: code.slice(0, c) + s + code.slice(c), caret: c + s.length };
}

export function deleteBack(code: string, caret: number): { code: string; caret: number } {
  const c = clamp(code, caret);
  if (c === 0) return { code, caret: 0 };
  return { code: code.slice(0, c - 1) + code.slice(c), caret: c - 1 };
}

export function caretLeft(code: string, caret: number): number {
  return Math.max(0, clamp(code, caret) - 1);
}
export function caretRight(code: string, caret: number): number {
  return Math.min(code.length, clamp(code, caret) + 1);
}

export function lines(code: string): string[] {
  return code.split("\n");
}

export function caretRowCol(code: string, caret: number): { row: number; col: number } {
  const before = code.slice(0, clamp(code, caret));
  const ls = before.split("\n");
  return { row: ls.length - 1, col: ls[ls.length - 1].length };
}

export function rowColToCaret(code: string, row: number, col: number): number {
  const ls = lines(code);
  const r = Math.max(0, Math.min(ls.length - 1, row));
  const c = Math.max(0, Math.min(ls[r].length, col));
  let idx = 0;
  for (let i = 0; i < r; i++) idx += ls[i].length + 1; // +1 for the newline
  return idx + c;
}

export function caretUp(code: string, caret: number): number {
  const { row, col } = caretRowCol(code, caret);
  return row === 0 ? 0 : rowColToCaret(code, row - 1, col);
}
export function caretDown(code: string, caret: number): number {
  const { row, col } = caretRowCol(code, caret);
  return row >= lines(code).length - 1 ? code.length : rowColToCaret(code, row + 1, col);
}

// The Workshop's screens (an overlay state machine, driven by the 3 buttons):
//   list — your carts + "+ NEW CART"
//   edit — the on-LCD code editor (keyboard types; SEL/ACC move caret; CANCEL = menu)
//   menu — the command palette over the editor (run/save/help/rename/delete/share/exit)
//   help — the API cheat-sheet
// (Preview reuses the full-screen Cart runner overlay, so it isn't a mode here.)
export type WorkshopView =
  | { mode: "list"; cursor: number }
  | { mode: "edit"; doc: CartDoc }
  | { mode: "menu"; cursor: number; doc: CartDoc }
  | { mode: "help"; doc: CartDoc; page: number };

export const WORKSHOP_MENU = ["RUN", "SAVE", "API HELP", "RENAME", "DELETE", "SHARE", "EXIT"] as const;

/** Sanitize a typed cart name: caps, trimmed, A-Z0-9 + a few marks, capped. */
export function cleanName(raw: string): string {
  const n = raw.toUpperCase().replace(/[^A-Z0-9 _-]/g, "").trim().slice(0, NAME_MAX);
  return n.length ? n : "MYCART";
}
