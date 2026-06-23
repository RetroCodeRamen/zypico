import { describe, expect, it } from "vitest";
import {
  decodeFragment,
  encodeFragment,
  FRAG_HEADER_LEN,
  fragment,
  fragmentToFrames,
  Reassembler,
} from "./fragment.ts";
import { decodeFrame } from "./frame.ts";
import { SubType } from "./subtypes.ts";

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i & 0xff);

describe("FRAG envelope", () => {
  it("round-trips a header and chunk", () => {
    const chunk = bytes(20);
    const env = encodeFragment({ msgId: 0xdead_beef, index: 2, total: 5 }, chunk);
    const frag = decodeFragment(env);
    expect(frag.msgId).toBe(0xdead_beef);
    expect(frag.index).toBe(2);
    expect(frag.total).toBe(5);
    expect(frag.chunk).toEqual(chunk);
  });

  it("rejects an index outside total and a short payload", () => {
    expect(() => encodeFragment({ msgId: 1, index: 5, total: 5 }, bytes(1))).toThrow();
    expect(() => decodeFragment(new Uint8Array(4))).toThrow();
  });
});

describe("fragment()", () => {
  it("splits data into ceil(len/maxChunk) pieces", () => {
    const frags = fragment(1, bytes(250), 100);
    expect(frags.length).toBe(3);
    expect(decodeFragment(frags[0]).total).toBe(3);
    expect(decodeFragment(frags[0]).chunk.length).toBe(100);
    expect(decodeFragment(frags[2]).chunk.length).toBe(50);
  });

  it("emits a single fragment for small or empty data", () => {
    expect(fragment(1, bytes(10), 100).length).toBe(1);
    expect(fragment(1, new Uint8Array(0), 100).length).toBe(1);
  });

  it("fragmentToFrames wraps each piece in a FRAG frame", () => {
    const frames = fragmentToFrames(7, bytes(300), 100);
    expect(frames.length).toBe(Math.ceil(300 / (100 - FRAG_HEADER_LEN)));
    const decoded = decodeFrame(frames[0]);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.frame.subtype).toBe(SubType.FRAG);
  });
});

describe("Reassembler", () => {
  it("reassembles fragments arriving in order", () => {
    const data = bytes(250);
    const frags = fragment(42, data, 100);
    const r = new Reassembler();
    expect(r.accept(frags[0]).status).toBe("incomplete");
    expect(r.accept(frags[1]).status).toBe("incomplete");
    const res = r.accept(frags[2]);
    expect(res.status).toBe("complete");
    if (res.status !== "complete") return;
    expect(res.data).toEqual(data);
  });

  it("reassembles fragments arriving out of order", () => {
    const data = bytes(250);
    const frags = fragment(42, data, 100);
    const r = new Reassembler();
    r.accept(frags[2]);
    r.accept(frags[0]);
    const res = r.accept(frags[1]);
    expect(res.status).toBe("complete");
    if (res.status !== "complete") return;
    expect(res.data).toEqual(data);
  });

  it("ignores duplicate fragments", () => {
    const frags = fragment(42, bytes(250), 100);
    const r = new Reassembler();
    r.accept(frags[0]);
    expect(r.accept(frags[0]).status).toBe("duplicate");
    expect(r.missing(42)).toEqual([1, 2]);
  });

  it("reports missing indices for a selective-repeat NACK, then resumes", () => {
    const data = bytes(250);
    const frags = fragment(42, data, 100);
    const r = new Reassembler();
    r.accept(frags[0]);
    r.accept(frags[2]); // fragment 1 lost
    expect(r.missing(42)).toEqual([1]);
    expect(r.isPending(42)).toBe(true);
    // The re-sent fragment 1 completes the transfer rather than restarting it.
    const res = r.accept(frags[1]);
    expect(res.status).toBe("complete");
    if (res.status !== "complete") return;
    expect(res.data).toEqual(data);
    expect(r.isPending(42)).toBe(false);
  });

  it("keeps concurrent transfers independent", () => {
    const a = fragment(1, bytes(150), 100);
    const b = fragment(2, bytes(150), 100);
    const r = new Reassembler();
    r.accept(a[0]);
    r.accept(b[0]);
    expect(r.missing(1)).toEqual([1]);
    expect(r.missing(2)).toEqual([1]);
    expect(r.accept(a[1]).status).toBe("complete");
    expect(r.accept(b[1]).status).toBe("complete");
  });

  it("rejects a msgId reused with a different total", () => {
    const r = new Reassembler();
    r.accept(fragment(9, bytes(150), 100)[0]); // total 2
    const clash = fragment(9, bytes(350), 100)[0]; // total 4, same msgId
    expect(r.accept(clash).status).toBe("inconsistent");
  });

  it("bounds in-flight transfers, evicting the oldest", () => {
    const r = new Reassembler(2);
    r.accept(fragment(1, bytes(150), 100)[0]);
    r.accept(fragment(2, bytes(150), 100)[0]);
    r.accept(fragment(3, bytes(150), 100)[0]); // evicts msgId 1
    expect(r.isPending(1)).toBe(false);
    expect(r.isPending(2)).toBe(true);
    expect(r.isPending(3)).toBe(true);
  });

  it("drops an abandoned transfer", () => {
    const r = new Reassembler();
    r.accept(fragment(5, bytes(150), 100)[0]);
    r.drop(5);
    expect(r.isPending(5)).toBe(false);
    expect(r.missing(5)).toEqual([]);
  });
});
