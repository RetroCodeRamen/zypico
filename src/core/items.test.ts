import { describe, expect, it } from "vitest";
import { addItem, ITEM_DEFS, randomTreat, STACK_CAP, TREATS, useItem, type InvEntry } from "./items.ts";

describe("items inventory", () => {
  it("adds a new item, then stacks duplicates", () => {
    let inv: InvEntry[] = [];
    inv = addItem(inv, "berry");
    expect(inv).toEqual([{ id: "berry", count: 1 }]);
    inv = addItem(inv, "berry");
    expect(inv).toEqual([{ id: "berry", count: 2 }]);
  });

  it("ignores unknown ids (no clutter)", () => {
    expect(addItem([], "not_a_real_item")).toEqual([]);
  });

  it("caps a stack at STACK_CAP", () => {
    let inv: InvEntry[] = [];
    for (let i = 0; i < STACK_CAP + 5; i++) inv = addItem(inv, "berry");
    expect(inv[0].count).toBe(STACK_CAP);
  });

  it("consumes and removes the slot at zero", () => {
    let inv = addItem(addItem([], "starsnack"), "starsnack"); // count 2
    inv = useItem(inv, "starsnack");
    expect(inv).toEqual([{ id: "starsnack", count: 1 }]);
    inv = useItem(inv, "starsnack");
    expect(inv).toEqual([]); // gone
  });

  it("every treat is a real, usable item", () => {
    for (const t of TREATS) { expect(ITEM_DEFS[t]).toBeDefined(); expect(ITEM_DEFS[t].usable).toBe(true); }
    expect(TREATS).toContain(randomTreat());
  });
});
