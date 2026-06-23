import { describe, expect, it } from "vitest";
import { currentPlace, INITIAL_NAV, navReduce, PLACES, type NavState } from "./nav.ts";

const run = (state: NavState, ...actions: Parameters<typeof navReduce>[1][]) =>
  actions.reduce(navReduce, state);

describe("nav — home level", () => {
  it("idles with no icon highlighted", () => {
    expect(INITIAL_NAV.iconIndex).toBeNull();
  });

  it("SELECT begins at the first icon, then cycles and wraps", () => {
    let s = navReduce(INITIAL_NAV, "select");
    expect(s.iconIndex).toBe(0);
    s = navReduce(s, "select");
    expect(s.iconIndex).toBe(1);
    s = run(s, ...Array(PLACES.length - 1).fill("select"));
    expect(s.iconIndex).toBe(0); // wrapped all the way round
  });

  it("select-prev from idle highlights the last icon", () => {
    const s = navReduce(INITIAL_NAV, "select-prev");
    expect(s.iconIndex).toBe(PLACES.length - 1);
  });

  it("ACCEPT with nothing highlighted is a no-op", () => {
    expect(navReduce(INITIAL_NAV, "accept")).toEqual(INITIAL_NAV);
  });

  it("ACCEPT enters the highlighted place", () => {
    const s = run(INITIAL_NAV, "select", "select", "accept"); // highlight index 1, enter
    expect(s.level).toBe("place");
    expect(currentPlace(s).id).toBe(PLACES[1].id);
    expect(s.itemIndex).toBe(0);
    expect(s.selectedItem).toBeNull();
  });

  it("CANCEL at home clears the highlight back to idle", () => {
    const s = run(INITIAL_NAV, "select"); // highlight index 0
    expect(navReduce(s, "cancel").iconIndex).toBeNull();
  });
});

describe("nav — place level", () => {
  const enterFirstPlace = () => run(INITIAL_NAV, "select", "accept");

  it("cycles menu items with SELECT, wrapping", () => {
    let s = enterFirstPlace();
    const n = currentPlace(s).items.length;
    s = navReduce(s, "select");
    expect(s.itemIndex).toBe(1);
    s = run(s, ...Array(n - 1).fill("select"));
    expect(s.itemIndex).toBe(0);
  });

  it("ACCEPT selects the highlighted item", () => {
    const s = run(enterFirstPlace(), "select", "accept");
    expect(s.selectedItem).toBe(1);
  });

  it("CANCEL deselects a selected item before leaving (the set rule)", () => {
    let s = run(enterFirstPlace(), "accept"); // selectedItem = 0
    expect(s.selectedItem).toBe(0);
    s = navReduce(s, "cancel"); // deselect, stay in place
    expect(s.selectedItem).toBeNull();
    expect(s.level).toBe("place");
    s = navReduce(s, "cancel"); // nothing selected → back home
    expect(s.level).toBe("home");
  });

  it("returns home to idle (no icon highlighted) when nothing is selected", () => {
    let s = run(INITIAL_NAV, "select", "select", "select", "accept"); // enter place index 2
    s = navReduce(s, "cancel"); // back home
    expect(s.level).toBe("home");
    expect(s.iconIndex).toBeNull();
  });

  it("SELECT is inert while an item is selected", () => {
    const s = run(enterFirstPlace(), "accept", "select");
    expect(s.itemIndex).toBe(0);
    expect(s.selectedItem).toBe(0);
  });
});
