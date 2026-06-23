// On-air message catalog (outline §11.3). One private portnum carries all Relay
// traffic; this 1-byte sub-type distinguishes message kinds. Values are fixed
// wire constants — never renumber an existing one; only append.

export enum SubType {
  // presence / identity
  PRESENCE = 0x01,
  PROFILE = 0x02,
  WISP_SIG = 0x03,

  // private messaging
  IM = 0x10,
  MAIL = 0x11,

  // communities
  POST = 0x20,
  CLUB_MSG = 0x21,

  // play
  GAME_INVITE = 0x30,
  GAME_MOVE = 0x31,
  GAME_RESULT = 0x32,

  // world / quests
  QUEST_DEF = 0x40,
  QUEST_EVENT = 0x41,

  // creation / large content
  CONTENT_PUB = 0x50,
  CART = 0x51,
  WISP_GIFT = 0x52,

  // large-transfer plumbing
  MANIFEST = 0x60,
  PULL_REQ = 0x61,
  PULL_SERVE = 0x62,

  // moderation
  BLOCKLIST = 0x70,

  // economy
  TRADE_OFFER = 0x80,
  GIFT = 0x81,

  // fragmentation / acknowledgement envelopes
  FRAG = 0xf0,
  ACK = 0xf1,
  NACK = 0xf2,
}

const KNOWN = new Set<number>(
  Object.values(SubType).filter((v): v is number => typeof v === "number"),
);

/** Receivers skip sub-types they don't recognise (outline §11.3). */
export function isKnownSubType(value: number): value is SubType {
  return KNOWN.has(value);
}

export function subTypeName(value: number): string {
  return SubType[value] ?? `0x${value.toString(16).padStart(2, "0")}`;
}
