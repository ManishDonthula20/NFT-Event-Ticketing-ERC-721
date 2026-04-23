/**
 * Helpers for dealing with IPFS URIs stored on-chain.
 *
 * The contract stores a plain `metadataURI` string per event — usually an
 * `ipfs://<CID>[/path]` pointer to either a JSON metadata document or a
 * raw image. IPFS bytes are served over HTTP via public gateways; we
 * rotate through a short list so a temporary outage on one provider
 * doesn't break every poster at once.
 */

// Ordered by how reliably they've served content in our testing.
// Keep this short: too many gateways = too many failed fetches.
const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
];

/**
 * Converts an `ipfs://…` (or bare CID) URI into a regular https URL that
 * browsers can fetch / render. Passes http(s) URLs through unchanged and
 * returns `null` for empty input so callers can `if (!url) return null`.
 */
export function ipfsToHttp(uri, gatewayIndex = 0) {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const gw = GATEWAYS[gatewayIndex % GATEWAYS.length];

  if (trimmed.startsWith("ipfs://")) {
    // Strip any leading "ipfs/" that some tooling double-prefixes.
    const rest = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return gw + rest;
  }
  // Bare CID (v0 "Qm…" or v1 "bafy…") — treat as a direct IPFS reference.
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[0-9a-z]+)(\/|$)/.test(trimmed)) {
    return gw + trimmed;
  }
  return trimmed;
}

/**
 * Returns all gateway URLs we could try for the same content, in order.
 * Useful for <img onError> fallback chains.
 */
export function ipfsGatewayUrls(uri) {
  if (!uri) return [];
  return GATEWAYS.map((_, i) => ipfsToHttp(uri, i)).filter(Boolean);
}

/** Heuristic: does the URI's path look like an image file? */
export function isLikelyImageUri(uri) {
  if (!uri) return false;
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i.test(uri);
}
