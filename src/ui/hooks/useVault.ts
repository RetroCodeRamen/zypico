import { useEffect, useRef, useState } from "react";
import { open, seal, type Identity } from "@core/identity/index.ts";
import { decodeVault, encodeVault, encodeVaultReq, SubType } from "@core/protocol/index.ts";
import { type VaultBlob, applyVault, gatherVault } from "@app/storage/vault.ts";
import type { Relay } from "@ui/hooks/useRelay.ts";

export type VaultStatus = "idle" | "backed-up" | "requesting" | "restored";

// Account Vault (DESIGN §5.4): an encrypted backup of local state stored at a
// Station. The blob is sealed to ourselves (X25519 to our own key, derived from
// handle+password), so only re-deriving our identity decrypts it — the Station
// holds opaque ciphertext. `onRestored` re-loads the hooks after a restore.
export function useVault(identity: Identity | null, link: Relay, onRestored: (fp: string) => void) {
  const [status, setStatus] = useState<VaultStatus>("idle");
  const [lastBackup, setLastBackup] = useState(0);
  const identityRef = useRef<Identity | null>(identity);
  const onRestoredRef = useRef(onRestored);
  identityRef.current = identity;
  onRestoredRef.current = onRestored;

  // Receive our vault back from a Station, decrypt it, and restore it.
  useEffect(() => link.onInbound((f) => {
    if (f.subtype !== SubType.VAULT) return;
    const me = identityRef.current;
    if (!me) return;
    const v = decodeVault(f.payload);
    if (!v || v.ownerFp !== me.fingerprint) return;
    const opened = open(me.secretKey, me.publicKey, v.ciphertext);
    if (!opened) return; // not ours to decrypt
    try {
      applyVault(me.fingerprint, JSON.parse(new TextDecoder().decode(opened)) as VaultBlob);
      onRestoredRef.current(me.fingerprint);
      setStatus("restored");
    } catch { /* malformed vault — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** Encrypt local state and store it at a Station (broadcast; any VAULT Station keeps it). */
  const backup = () => {
    const me = identityRef.current;
    if (!me) return;
    const sealed = seal(me.secretKey, me.publicKey, new TextEncoder().encode(JSON.stringify(gatherVault(me.fingerprint))));
    link.send(SubType.VAULT_PUT, encodeVault(me.fingerprint, Date.now(), sealed));
    setLastBackup(Date.now());
    setStatus("backed-up");
  };

  /** Ask a Station for our stored vault (the inbound handler restores it). */
  const restore = () => {
    const me = identityRef.current;
    if (!me) return;
    link.send(SubType.VAULT_REQ, encodeVaultReq(me.fingerprint));
    setStatus("requesting");
  };

  return { status, lastBackup, backup, restore };
}
