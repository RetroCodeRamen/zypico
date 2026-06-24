# ZyPico Redesign — "A place you live, not an app you launch"

_Status: proposal for review · 2026-06-24 · supersedes the navigation/UX portions
of [DESIGN.md](DESIGN.md) §6. Backend systems (identity, RelayProtocol, Stations,
mail/page/cart/vault) are **preserved** — see §15 Migration._

## North star

Three priorities reshape the moment-to-moment experience:

1. **Navigation that reads as places, not an app launcher.** Fewer destinations,
   grouped by intent (talk / visit / play / make / care), reached as *travel*.
2. **Wisps are animated companions.** Every action visibly happens in the room;
   Play contains real minigames; Wisps battle.
3. **The world is explorable.** Visiting Travelers, Stations, and Relay locations
   feels like *arriving somewhere*, with discoveries and remembered history.

The central **128×80** matrix is always the living world. The hi-res frame holds
navigation, status, and quiet notifications — physical controls around a tiny world.

---

## 1. Revised top-level navigation (information architecture)

The old eight flat icons split related things apart (comms across Commons /
Travelers / Post / Stations; making across Arcade / Exchange / Lua). Regroup —
still **eight icons**, but grouped by *meaning*, not by backend service:

| Destination | Holds | "I want to…" |
|---|---|---|
| **Home** (the Wisp's room) | Care + Play with the Wisp; gateways into the world; your history | care for / play with my Wisp |
| **The Relay** | The explorable social region: **Commons** (talk publicly), **Travelers** (who's nearby · message a Traveler · DMs), **The Post** (delayed messages / Mail), **Stations** (visit), **Pages** directory (visit a Page), exploration/map | talk, message, read mail, see who's nearby, visit a Station, explore, visit a Page |
| **Arcade** | Play: Wisp **minigames**, Wisp **battles** (vs Travelers), and **Carts** to run | play a game |
| **Workshop** (the Lab) | Create: the **Lua editor**, your Carts (author / edit / share), the **Exchange** (download/trade Carts), your **Page** editor | create a Cart, trade/download a Cart, edit my page |
| **Bag** | Your **items + collection**: treats, toys, decorations, badges, Page stamps, Station souvenirs, gifts — and their *uses* | see/use my stuff, equip, decorate, gift |
| **Profile** | *Who you are*: identity, **Vault** backup | manage my identity / back up |
| **Settings** | *System*: sound on/off, region/LoRa, notifications, reduced-motion, display, relay/device status | change device settings |
| **Alerts** | The attention light + a list of what needs you (messages, battle invites, Wisp needs), jumping to the right place | know when something needs me |

Pages are reached **inside the Relay** (a directory) and from a Traveler ("view
page") rather than as a top icon. Mail/DMs/Commons/Stations all live under the
**Relay**, so "communication" is one place you travel into, with rooms inside.

Rationale: this maps 1:1 to the user's intent list, hides transport/runtime
details (LoRa, wasmoon, store-and-forward), and turns "open an app" into "go
somewhere." Home is a *room*, not a launcher.

### Alerts — the Tamagotchi attention light

Borrowed straight from a Tamagotchi's "your pet is calling you" icon. The **Alerts**
icon is dark/quiet until something needs you, then **lights up in its hue + a soft
beep** (the board's OLED can blink too). Triggers: a new **DM**, new **Mail**, a
**guestbook reply**, a **battle invite**, a **Station event**, or the **Wisp
needing care**. Selecting it opens a tiny **alerts list** ("BYTEBUG SENT A DM",
"WISP IS HUNGRY", "BATTLE INVITE") and **jumps to the right place**; clearing turns
the light off. This keeps unread state on *one* dedicated indicator instead of a
swarm of badge counts across every icon.

### Settings (top-level)

Split out from Profile so system config is its own place: **sound on/off**,
**LoRa region/params**, **notification** preferences (which events light Alerts),
**reduced-motion**, display/contrast, and **relay/device status** (connection,
node id, reconnect). Profile keeps just *who you are* — identity + Vault.

### Recommended navigation approach

**Diegetic gateways in the Wisp's room (primary) + a persistent destination rail
on the hi-res frame (shortcut).** You leave home through objects in the room; the
frame rail lets you jump directly and shows where you are + unread activity.

Why this over the alternatives (map / wheel / town): it makes Home a *place* (the
heart of priority 3), keeps travel diegetic, and degrades gracefully to a tiny
3-button device while scaling up to the T-Deck:

- **Heltec (3 buttons):** in the room, **SELECT** cycles the highlight across the
  room's gateway objects (and the frame rail mirrors the highlight); **ACCEPT**
  travels there; **CANCEL** = back / hold-CANCEL = Home from anywhere.
- **T-Deck (trackball + keyboard):** the trackball moves a cursor onto a room
  object or rail icon (point-and-go); number/letter keys are direct shortcuts to
  each destination; the frame rail is tappable on the touch screen.

The room and the rail express the *same* structure, so a new user learns the
world by looking at the room, and a power user uses the rail.

---

## 2. Icon & visual-navigation system

A coherent icon language for the **frame rail** (and the room's gateway objects
echo the same silhouettes). Fixed slot order — **Alerts is always the last slot**:

| # | Destination | Silhouette | Dominant color (PICO-8) | Room gateway object |
|---|---|---|---|---|
| 1 | Home | a little house / the Wisp itself | warm yellow (10) | (you are here) |
| 2 | The Relay | radio tower with broadcast arcs | blue (12) | a **radio** on a shelf |
| 3 | Arcade | arcade cabinet / joystick | red (8) | a small **cabinet** |
| 4 | Workshop | wrench-over-bracket / workbench | lavender (13) | a **workbench/terminal** |
| 5 | Bag | a satchel / pouch | green (11) | a **travel bag** by the door |
| 6 | Profile | head-and-shoulders | peach (15) | a **mirror** |
| 7 | Settings | gear | grey (6) | a **gear/knob** on the wall |
| 8 | **Alerts** _(last slot)_ | a bell / signal-burst that **lights up** | orange (9) when active, dim when quiet | the Wisp itself "calls" you |

Icon rules:
- Single-color, single-weight stroke; identity from **silhouette + position +
  one hue**, never gradients or rounded-rect "app tiles."
- Crisp on the hi-res frame (vector), framing the chunky 128×80 world — the
  alternate-2002 handheld look, not smartphone icons.
- **Selected** destination: filled/glowing in its hue with a bracket; others dim.
- **Attention** is centralized on the **Alerts** icon (last slot), which lights up
  + beeps — the one place unread/needs-you state lives, so the rail never becomes
  a swarm of badge counts. (A destination may show at most a single quiet dot if
  ever needed, but Alerts is the primary indicator.)

---

## 3. The Wisp's home-room layout

The room is the home screen and the hub. Layout inside the 128×80 matrix:

```
┌──────────────────────────────── 128 ───────────────────────────────┐
│ NAME            mood-face            ·stars·            =RELAY  ·MUTE│  status strip (y0-7)
│  [radio]                                              [cabinet]      │  gateway objects on
│            ✦                                                        │  shelves/walls
│                     (Wisp wanders + animates here)                  │
│   [mirror]                ☁ idle dream / sparkle           [bench]  │
│                                                                     │
│ ──────────────────── floor ─────────────────────────────────────── │  ground (y66)
│ > RADIO  (the highlighted gateway's name)                          │  footer label (y73)
└─────────────────────────────────────────────────────────────────────┘
```

- Gateway objects sit around the room: **radio** (→ Relay), **arcade cabinet**
  (→ Arcade), **workbench/terminal** (→ Workshop), **mirror/gear by the door**
  (→ Profile). A **door/window** can double as the Relay/Travelers entry.
- The Wisp wanders, reacts to mood, naps, plays with found objects, and shows
  **souvenirs** placed on shelves (items from §10).
- SELECT moves the highlight object→object (footer names it); ACCEPT travels.
- Caring for / playing with the Wisp happens *in the room* (§4) — not a submenu.
- Newly-found items, guestbook stamps, and Station souvenirs appear as room
  decorations over time, so the room becomes a personal history.

---

## 4. Animated interaction sequences

Principle: **the player never selects an action and just watches a number.** Each
care verb plays a short, skippable, locally-rendered sequence in the room. Care
moves **Bond/Mood** (existing system), never Hearts.

For each: _what shows · what animates · what you press · what the Wisp does ·
what you gain · what's remembered · return._ All run in the room; CANCEL aborts.

### Feed
- Press **ACCEPT** on the Wisp → a small **food bowl** appears on the floor.
- The Wisp **notices** (ears/eyes turn), **walks** to it, plays a **3–6 frame
  eat** animation, then a **reaction** by preference (happy bounce / neutral /
  "meh" turn-away). Crumbs scatter; a soft chomp SFX; a `<3` or `~` puff.
- Form-specific eating: Flicker nibbles, an Ember swallows whole, a Glow bats it
  first. **Favorite/disliked foods** discovered on first taste and remembered.
- Gain: +fed/+joy (Mood). Remembered: this Wisp likes/dislikes that food.

### Treat (special, not a 2nd Feed)
- A wrapped **treat** the Wisp recognizes → **exaggerated** reaction (spin, big
  eyes, hop), a brief **visual effect** (confetti pixels, color shimmer).
- Treats are **collected from exploration** or **gifted by Travelers** (limited),
  not infinite. Occasionally unlocks a **memory**, a **decoration**, or a playful
  recurring behavior. Optional, non-punitive.

### Clean
- Over time **dust/static/digital-debris** specks accrue on the Wisp/room.
- Press to get a **brush/cloth cursor**; SELECT moves it, ACCEPT scrubs spots.
- The Wisp **reacts**: some lean in happily, some **dodge** or make a mess.
- Cleaning may **reveal** a misplaced object / small collectible. Room never
  becomes disturbing or "dying" — debris is gentle and cosmetic.

### Rest
- Room **atmosphere shifts**: lights dim, a **nest/blanket/charger** appears, the
  Wisp curls up with **idle sleep** frames and drifting `z z z` + dream symbols.
- Does **not** lock other features — you can still travel; the room stays dim
  until you return and the Wisp wakes. Returning may reveal a **remembered dream**
  or a tiny **dream drawing** kept as a souvenir.

### Talk
- The Wisp says **short** lines (≤22 chars) that draw on real memory: comments on
  **recent Travelers** ("I LIKED BYTEBUG"), **new Stations** ("HEARD OF MOSS
  TOWER?"), **Pages/Carts** seen, asks **simple questions**, develops **recurring
  phrases**, **misunderstands** amusingly, recognizes **repeat encounters**.
- Not a chatbot: a small weighted pool seeded by the discovery/memory log (§11),
  rotating. ACCEPT advances lines; CANCEL ends.

### Play
- Opens the **Wisp minigame picker** (§5) — Play is *real games with the Wisp*,
  not an animation + stat bump. Builds **Bond**, may drop a small reward.

---

## 5. Three Wisp minigames (solo, with your Wisp)

All: 20 s–2 min, two-button-friendly, expressive Wisp animation, **no harsh
failure** (you always finish; better play = more Bond / a chance at a reward).

### A. Snackfall (catch)
- Treats fall from the top; move the Wisp left/right (**SELECT**/**ACCEPT**) to
  catch them in its mouth. Misses just bounce away. 30–60 s.
- Wisp animates open-mouth lunges + happy chews. Reward chance scales with catches;
  +Bond always. Can surface a **favorite-food** discovery.

### B. Echo (pattern memory)
- The Wisp lights up a sequence of 2–3 spots (its body/room corners); you repeat
  it with **SELECT** = left/this, **ACCEPT** = right/that (or a 2-symbol code).
  Sequence grows; a miss ends the round gently with an "oops" wiggle. ~45 s.
- Builds to longer patterns; Bond + occasional **sticker** reward.

### C. Bounce (timing/rhythm)
- A ball/balloon falls; tap **ACCEPT** as it nears the Wisp to **bop** it up;
  **SELECT** nudges horizontally. Keep it aloft; combo counter. ~60 s.
- Expressive bops/headers; near-misses are forgiving. Reward at combo milestones.

Expansion games: **Hide-and-seek** (the Wisp hides; you reveal cells), **two-Wisp
co-op** (over the mesh, low-rate), **simple race**.

These are distinct from **Arcade Carts** (full Lua programs). Wisp minigames are
built-in, tied to your Wisp + Bond; Carts are user software you run.

---

## 6. Wisp battles (two-button)

Quick, understandable, LoRa-friendly mind-game. **No real-time sync** — turn-based
commit/reveal. Wisps are never injured, never lose permanent health.

### Core rules
- Two inputs: **SELECT** and **ACCEPT**.
- Each round one player is **ATTACKER**, the other **BLOCKER** (shown clearly).
- **Attacker scores** if the two choices **differ**. **Blocker blocks** if they
  **match**.
- **Roles alternate every round** (resolves the ambiguity cleanly + keeps it
  fair): after any round the attacker/blocker swap. This satisfies "blocker
  becomes attacker on a block," and on a score the scored-upon player gets
  offense next — no one can hammer to 3 from one side.
- **First to 3 points wins.**
- Outcome is **symmetric/deterministic** from the two revealed choices, so both
  devices compute the same score with no authority.

### Flow (player-facing)
1. Find/select a Traveler (in the Relay).
2. Send **battle invite**; they **accept/decline**.
3. Both verify opponent + Wisp (signed identities, Wisp form in the invite).
4. Battle screen loads; roles shown.
5. Each **secretly** picks SELECT/ACCEPT.
6. Choice is **committed** (hash) before reveal.
7. Both **reveal**; hashes verified.
8. Short **charge / shield / dodge / impact** animation (local).
9. Score + new roles shown.
10. First to 3 wins; victory/defeat poses (harmless).
11. Both devices record the result + any souvenir.

### Progression (not win-or-die)
Battles can feed the **Arena Heart**, but reward **participation**: battle
**memories**, cosmetic **badges**, win/play **streak records**, new **poses**,
**arena decorations**, rivalry dialogue, **rematch history**, and **rare
souvenirs** for facing different Wisp forms. You never *must* beat others to evolve.

---

## 7. Battle network protocol (commit-and-reveal over LoRa)

Reuses the reserved subtypes `GAME_INVITE (0x30)`, `GAME_MOVE (0x31)`,
`GAME_RESULT (0x32)`. All frames ride the existing RelayProtocol (signed sender,
hop-limit, dedupe, fragmentation, governor). A **battleId** (random u32) scopes a
match; a **round** index orders turns; everything is **idempotent** by
(battleId, round, kind).

```
INVITE   GAME_INVITE  [battleId:4][fromFp:6][wispForm:1][nonce:4]      (signed presence implies identity)
ACCEPT   GAME_INVITE  [battleId:4][accept:1][wispForm:1]               (1=accept,0=decline)
COMMIT   GAME_MOVE    [battleId:4][round:1][kind=0][commit:32]         commit = sha256(choice<<… ‖ salt:16)
REVEAL   GAME_MOVE    [battleId:4][round:1][kind=1][choice:1][salt:16]
RESULT   GAME_RESULT  [battleId:4][myScore:1][oppScore:1][round:1]     periodic + final agreement check
```

**Commit/reveal per round:** each device picks its choice + 16-byte salt, sends
COMMIT(hash). When **both commits** are in hand, each sends REVEAL. On receiving
the opponent's reveal, verify `sha256(choice‖salt) == their commit`; if it fails →
**cheat/dispute** → abort the match (no winner recorded). Neither player can
choose after seeing the other's choice, because choices are locked by the hash
before any reveal travels.

**Resolution:** with both choices known, both devices compute the round (differ →
attacker scores; match → block), swap roles, advance `round`. Periodic RESULT
frames carry each side's running score; if they ever disagree → **desync** → both
show "battle desynced" and abort (recorded as no-result).

**Recovery:**
- *Lost/duplicate packets:* dedupe by (battleId, round, kind); re-send the last
  unacked frame on a short retransmit timer until the next phase frame arrives.
- *Delayed responses:* per-phase timer (e.g., 8 s); resend, then a longer
  **forfeit** timer (e.g., 45 s) → opponent unreachable → battle paused.
- *Disconnect / out of range:* if no frames for the forfeit window, offer
  **resume** (if they reappear) or **abandon** (no-result, not a loss-by-default
  unless mutually timed out at match point — configurable, default no-result).
- *Timeouts at choice:* a player who never commits within the phase window
  auto-forfeits **that round** only after a clear on-screen countdown.
- *Rematch:* a new battleId; rematch history is kept.
- *Station-assisted:* if not directly reachable, frames route via the mesh
  (multi-hop) or a Station relays them (a Station can also **hold** an invite like
  Mail so an offline Traveler sees it later — async challenge).
- *Disputes:* any hash-mismatch or score-disagreement aborts to **no-result**;
  ZyPico never lets one device unilaterally declare a win.

Bandwidth: a full best-of-5-rounds match is ~a dozen tiny frames (≤53 B each) —
well within LoRa duty cycle.

---

## 8. The Relay as an explorable place

Choosing a destination should feel like **traveling**, not opening a menu. The
Relay is a small set of **illustrated destination scenes** reached from a compact
**local map**, not a continuous graphical world.

Entering the Relay (from the room's radio):
- **Travel transition:** radio waves sweep across the 128×80, the connection
  glyph resolves, then the **Relay map** fades in (short — frequent travel can't
  be annoying; ≤~0.8 s, skippable).
- **Relay map** (a few nodes you can move between): **The Commons**, **Travelers**
  (nearby), **The Post** (mail), each reachable **Station**, **Pages directory**,
  and any **event** node. Each node shows a tiny live signal: traveler count,
  unread dot, "new cart," signal strength.

Destinations inside the Relay:
- **The Commons** — a room with a **public message board** on the wall; nearby
  Wisps appear as **silhouettes/visitors**; you post and read; "N here."
- **Travelers** — the people around you (Nearby vs Relay), each selectable →
  **Chat (DM)**, **Send Mail**, **View Page**, **View Wisp**, **Battle**.
- **The Post** — your mailbox: inbox letters, outbox in transit, delivery via
  Stations.
- **A Station** — see §9.
- **Pages directory** — Pages appear as **doors / posters / booths** you enter.

---

## 9. Station arrival & exploration

A Station is a **destination with identity**, not a network detail. On arrival:

- **Transition:** the Station **rises into view** as the link completes; its
  **name** + **custom greeting** appear; signal/reachability shown.
- **Station scene** (configurable theme/background) with selectable fixtures:
  - **Page directory** (hosted pages as doors/booths)
  - **Cart kiosks** (hosted Carts as cabinets/cartridges to download/run)
  - **Community board** (local posts/announcements)
  - **Local guestbook** (sign it → a Station **badge/stamp**)
  - **Mail desk** (this Station relays your outbox)
  - a **service unique to the Station** (owner-defined, within safe limits)
- **First visit** vs **return** is remembered (§11); arriving may show "Moss Tower
  has changed since your last visit."

Station owners configure (via the Station admin/daemon, safe-bounded): name,
greeting, theme, announcements, which services, a small set of discoverable items,
a badge. This is what turns invisible infrastructure into a place worth visiting.

---

## 10. Items & discovery system

Small, curiosity-driven, **not** a grind economy. Items are few, meaningful, and
have **visible uses**.

**Kinds:** food, treats, toys, room decorations, stickers, Page stamps, Station
badges, accessories/clothing, background objects, Cart souvenirs, signal
fragments, lost notes, lore scraps, seasonal objects, Traveler gifts.

**Sources (tied to doing things, capped/cooldowned so it stays special):** first
visit to a Station, returning to a familiar one, meeting a new Traveler, visiting
a Page, signing a guestbook, playing a Cart, winning/finishing a battle, community
events, an "unusual signal," or letting the Wisp investigate something in a scene.

**Uses (every item does something visible):** appears in the **room**, **worn** by
the Wisp, **unlocks dialogue**, placed on your **Page**, **gifted** to a Traveler,
used in a **Wisp game**, becomes a **guestbook stamp**, **triggers a memory**, or
**changes a room animation**. No use → not added (avoid clutter).

**Storage:** a small per-identity **inventory** (kept in the Vault backup), with a
hard cap and "favorite/equipped" slots; duplicates stack or convert to a tiny
keepsake rather than piling up.

---

## 11. Remembered history (repeated visits matter)

A per-identity **memory log** (extends the existing discoveries store) records:
first visit, visit count, Travelers met where, items found, Carts downloaded,
Pages visited, battles played, guestbook signatures, notable messages, and a
content hash so we can detect **"changed since last visit."**

Surfaced as short lines on arrival / in Talk / on the Relay map:
- "MOSS TOWER HAS CHANGED SINCE YOUR LAST VISIT"
- "YOUR WISP REMEMBERS MEETING BYTEBUG HERE"
- "A NEW CART HAS APPEARED"
- "SOMEONE REPLIED TO YOUR GUESTBOOK"
- "A STRANGE SIGNAL IS NEARBY"

The Wisp reacts at **home** to recent events (plays with a new item, comments on a
Traveler, shows a Station souvenir, tired after a battle, curious about a new Cart,
sticks a new guestbook stamp on the wall) — closing the leave→travel→return loop.

---

## 12. Text wireframes (major screens)

```
SPLASH (title screen — waits for input)        LOGIN
┌───────────────────────────┐                  ┌───────────────────────────┐
│        Z y P i c o         │                  │ ZYPICO     WELCOME BACK    │
│      (logo artwork)        │                  │ HANDLE  ____               │
│                            │                  │ PASSWORD ****              │
│     · PRESS ANY BUTTON ·   │  (gently loops)  │ NO RESET — REMEMBER IT     │
└───────────────────────────┘                  └───────────────────────────┘

HOME (the Wisp's room)                          RELAY MAP
┌───────────────────────────┐                  ┌───────────────────────────┐
│NAME    ^_^    ✦✦   =RELAY  │                  │ THE RELAY      3 NEAR ·1ST │
│ [radio]            [cab]   │                  │  (commons) (travelers•)    │
│        (wisp wanders)      │                  │   (the post)  (moss twr)   │
│ [mirror]   z      [bench]  │                  │      (pages)   (event!)    │
│ ───── floor ───────────── │                  │ ───────────────────────── │
│ > RADIO → THE RELAY        │                  │ > MOSS TOWER  ·MAIL ·CARTS │
└───────────────────────────┘                  └───────────────────────────┘

COMMONS (in the Relay)                          TRAVELER (selected)
┌───────────────────────────┐                  ┌───────────────────────────┐
│ THE COMMONS    4 HERE      │                  │ BYTEBUG        NEAR        │
│ [board]  ·visitor ·visitor │                  │  (their wisp)              │
│ WONK: hello relay          │                  │ > CHAT                     │
│ TANU: nice weather         │                  │   SEND MAIL                │
│ ───────────────────────── │                  │   VIEW PAGE                │
│ ACCEPT WRITE · SEL WHO'S   │                  │   BATTLE                   │
└───────────────────────────┘                  └───────────────────────────┘

STATION ARRIVAL                                 BATTLE
┌───────────────────────────┐                  ┌───────────────────────────┐
│ MOSS TOWER                 │                  │ YOU 1            BYTEBUG 2 │
│ "welcome, traveler"        │                  │   ATTACK!  vs  block       │
│ [pages][carts][board]      │                  │  (wisp charge animation)   │
│ [guestbook]  ·badge·       │                  │  CHOOSE: SELECT or ACCEPT  │
│ ───────────────────────── │                  │  ·committed· revealing…    │
│ > CART KIOSK   CHANGED!    │                  │                            │
└───────────────────────────┘                  └───────────────────────────┘

WISP PLAY PICKER                                WORKSHOP (Lua editor)
┌───────────────────────────┐                  ┌───────────────────────────┐
│ PLAY WITH NAME             │                  │ EDIT: MYCART      *unsaved │
│ > SNACKFALL                │                  │ function _draw()           │
│   ECHO                     │                  │   cls(1) print("HI",2,2,7) │
│   BOUNCE                    │                 │ end_                        │
│ ───────────────────────── │                  │ ───────────────────────── │
│ ACCEPT PLAY · CANCEL BACK  │                  │ ACCEPT RUN · OK SAVE       │
└───────────────────────────┘                  └───────────────────────────┘
```

---

## 13. Controls

**Heltec V3 (now — 3 buttons: SELECT / ACCEPT / CANCEL + on-screen keyboard):**
- Room/menus: SELECT = move highlight, ACCEPT = enter/confirm, CANCEL = back.
- **Home from anywhere:** hold CANCEL (~0.5 s) or the Home rail icon.
- Care: ACCEPT on the Wisp opens care; verbs are room interactions.
- Minigames/battle: SELECT + ACCEPT are the two inputs; CANCEL exits.
- Text/Lua editor: on-screen keyboard types; ACCEPT(hw) = save, on-screen **OK**
  = newline (editor), DEL = backspace; SELECT/CANCEL move the text cursor.

**LilyGO T-Deck (target — full QWERTY + trackball + touch):**
- Trackball/arrows move a cursor onto room objects, map nodes, and rail icons
  (point-and-go); trackball-press = ACCEPT; a key (e.g., `Esc`/`~`) = Home.
- QWERTY for chat, Lua, search; number keys jump to destinations directly.
- Touch dismisses the splash and taps fixtures/rail icons.
- Minigames/battle use two mapped keys (default the trackball + space) so the
  two-button design is identical across hardware.

The design is **two-button-complete** so every interaction works on the Heltec and
is merely *faster* on the T-Deck.

---

## 14. Launch version vs later expansion

**Launch (v1 of the redesign) — reorganize + make it alive:**
- New IA (Home room + the 8 icons: Relay/Arcade/Workshop/Bag/Profile/Settings/
  **Alerts** last) + frame rail + diegetic gateways + **hold-CANCEL Home**.
- **Alerts** attention light (DM/Mail/guestbook/battle-invite/Wisp-needs) + alerts
  list that jumps to the source; **Settings** split from Profile.
- Splash = title screen that waits for input (shipped now, §below).
- Animated Feed/Treat/Clean/Rest/Talk in the room (real sequences).
- Three Wisp minigames (Snackfall, Echo, Bounce).
- Two-button **Wisp battle** end-to-end (commit/reveal, recovery, Arena Heart).
- Relay = local **map** with travel transitions; **Commons / Travelers / Post /
  Station** as scenes; reachability + counts shown on arrival.
- Station arrival scene with name/greeting/theme + page/cart/guestbook fixtures.
- Items v1: a **small** curated set + inventory in the Vault; visible uses (room
  decoration, worn, guestbook stamp, gift).
- Memory log v1: first-visit / changed-since / "remembers meeting X."

**Expansion (v2+):**
- Two-Wisp co-op minigames + more battle poses/decorations + tournaments via
  Stations.
- Richer Station customization (custom rooms, unique services, events).
- Seasonal items/events; lore scraps; Page stamps; accessory layering.
- A location map that grows (more Relay node types, community boards).
- Wisp dialogue depth + recurring habits; dream drawings.
- (Hardware) T-Deck-native input + touch fixtures.

---

## 15. Migration plan (preserve the backend)

**Nothing in `src/core` or the Station/protocol layer needs to change.** The
redesign is the **UI/experience layer** over the same systems:

- **Keep as-is:** identity/crypto, RelayProtocol (frames/hop-limit/dedupe/frag/
  governor), presence v2, DMs, Mail + store-and-forward, Pages + hosting,
  Guestbooks, Carts + sandbox + Exchange, Stations + all stores, Vaults, the
  domain hooks (`useSocial`/`usePostOffice`/`usePageExchange`/`useCartExchange`/
  `useVault`/`useCompanion`).
- **Reorganize (UI only):** replace the 8-place `nav.ts` ring with the new IA
  (Home room + 5 destinations); the Relay becomes a sub-navigator that mounts the
  existing Commons/Travelers/Post/Stations views as *scenes*; Arcade/Workshop
  group the existing cart/exchange/(new) editor views. The current views become
  components inside the new places — minimal logic change.
- **Extend (additive):** new subtypes already reserved (`GAME_*`) for battles; an
  `items`/`memory` store extending `discoveries`; minigame modules under `ui/`;
  a `Relay`/`Station` scene layer; transitions.
- **Net new code is mostly presentational** (scenes, transitions, room, animations,
  minigames, battle UI) + the battle protocol (small, on reserved subtypes) +
  items/memory stores. The mesh, crypto, and Station services are untouched.

**Suggested build order:** (1) IA + room + Home-from-anywhere + Relay map shell
(re-mount existing views as scenes — also the natural place to fix the current
Commons/DM bug); (2) animated care + minigames; (3) battles + protocol; (4)
arrival scenes + items + memory.

---

## Splash screen behavior (title screen — implemented)

The splash is now a **title screen that waits for input**, not a timed overlay:
logo shown immediately; **no auto-dismiss timer**; a gently-looping `PRESS ANY
BUTTON` prompt; dismissed by any device button, keyboard key, or pointer/touch; a
short **arming delay** so a held button carried over from a prior action can't
skip it (requires a fresh press); respects `prefers-reduced-motion` (static
prompt, no blink); continues to login/session after dismissal. No maximum timeout.
