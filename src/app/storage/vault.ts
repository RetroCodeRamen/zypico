// Account Vault contents — gather the traveler's durable local state into one
// blob for an encrypted backup, and apply it back on restore (DESIGN §5.4). The
// blob is encrypted client-side before it ever leaves the device; this module
// only marshals it to/from the per-identity storage modules.

import { type Wisp } from "@core/companion/index.ts";
import { loadWisp, saveWisp } from "./wisp.ts";
import { type Buddy, loadBuddies, saveBuddies } from "./buddies.ts";
import { type TravelerPage, loadPage, savePage } from "./page.ts";
import { type GuestEntry, loadGuestbook, saveGuestbook } from "./guestbook.ts";
import { type DmThreads, loadDmThreads, saveDmThreads } from "./messages.ts";
import { type InboxMail, type OutboxMail, loadInbox, loadOutbox, saveInbox, saveOutbox } from "./mail.ts";
import { type Discovery, loadDiscoveries, saveDiscoveries } from "./discoveries.ts";

export interface VaultBlob {
  v: 1;
  wisp: Wisp;
  buddies: Buddy[];
  page: TravelerPage;
  guestbook: GuestEntry[];
  dms: DmThreads;
  inbox: InboxMail[];
  outbox: OutboxMail[];
  discoveries: Discovery[];
}

/** Collect everything worth backing up for this identity. */
export function gatherVault(fingerprint: string): VaultBlob {
  return {
    v: 1,
    wisp: loadWisp(fingerprint),
    buddies: loadBuddies(fingerprint),
    page: loadPage(fingerprint),
    guestbook: loadGuestbook(fingerprint),
    dms: loadDmThreads(fingerprint),
    inbox: loadInbox(fingerprint),
    outbox: loadOutbox(fingerprint),
    discoveries: loadDiscoveries(fingerprint),
  };
}

/** Restore a decrypted vault into local storage for this identity. */
export function applyVault(fingerprint: string, blob: VaultBlob): void {
  if (!blob || blob.v !== 1) return;
  if (blob.wisp) saveWisp(fingerprint, blob.wisp);
  if (blob.buddies) saveBuddies(fingerprint, blob.buddies);
  if (blob.page) savePage(fingerprint, blob.page);
  if (blob.guestbook) saveGuestbook(fingerprint, blob.guestbook);
  if (blob.dms) saveDmThreads(fingerprint, blob.dms);
  if (blob.inbox) saveInbox(fingerprint, blob.inbox);
  if (blob.outbox) saveOutbox(fingerprint, blob.outbox);
  if (blob.discoveries) saveDiscoveries(fingerprint, blob.discoveries);
}
