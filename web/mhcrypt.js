// Manhunt's team channel: end-to-end encrypted to your teammates. Every
// message on a party channel reaches every phone in the party, so a team's
// fuzzy positions and its chat are sealed per teammate before they're sent:
// each phone makes an ECDH key pair when the game starts and shares only
// the public half; a pair of phones derives one AES-GCM key between them.
// The other team's phones (the host's included) receive ciphertext only.
// Keys live in memory for one game and are never stored or sent anywhere.
// Where WebCrypto is missing, nothing is shared with the team at all.
const subtle = globalThis.crypto?.subtle;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function teamBox() {
  if (!subtle) return null;
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const pub = await subtle.exportKey("jwk", pair.publicKey);
  const peers = new Map();   // id -> { jwk, key: Promise<CryptoKey> }
  const keyFor = id => {
    const p = peers.get(id);
    if (!p) return null;
    p.key ??= subtle.importKey("jwk", p.jwk, { name: "ECDH", namedCurve: "P-256" }, false, [])
      .then(k => subtle.deriveKey({ name: "ECDH", public: k }, pair.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    return p.key;
  };
  return {
    pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y },
    // a teammate's public key (from their "mh-key" message)
    peer(id, jwk) { if (jwk?.x && jwk?.y && !peers.has(id)) peers.set(id, { jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } }); },
    has: id => peers.has(id),
    // seal one message for each of `ids`: { id: { iv, ct } }
    async seal(obj, ids) {
      const out = {}, data = enc.encode(JSON.stringify(obj));
      for (const id of ids) {
        const k = keyFor(id); if (!k) continue;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        out[id] = { iv: b64(iv), ct: b64(await subtle.encrypt({ name: "AES-GCM", iv }, await k, data)) };
      }
      return out;
    },
    // open the part meant for me (null if it isn't, or doesn't open)
    async open(from, box) {
      const k = keyFor(from); if (!k || !box) return null;
      try { return JSON.parse(dec.decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, await k, unb64(box.ct)))); }
      catch { return null; }
    },
    forget() { peers.clear(); },
  };
}
