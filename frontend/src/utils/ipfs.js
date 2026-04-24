/**
 * Helpers for turning on-chain `ipfs://` URIs into HTTP URLs a browser
 * can actually load.
 *
 * Gateway selection is adaptive based on which upload backend the app is
 * configured to use (see `utils/ipfsUpload.js`):
 *
 *   • If `VITE_PINATA_JWT` is set, uploads go to Pinata's cloud cluster.
 *     Pinata's own gateway is the one guaranteed to have the content
 *     instantly, so we try it FIRST. A dedicated Pinata subdomain
 *     (higher rate limits, faster) can be supplied via
 *     `VITE_PINATA_GATEWAY` (e.g. "https://mydomain.mypinata.cloud/ipfs/").
 *
 *   • If only `VITE_IPFS_GATEWAY` is set (e.g. a local Kubo daemon at
 *     http://127.0.0.1:8080/ipfs/), we try that first — this is the
 *     "no-Pinata, purely local" path.
 *
 *   • Otherwise we fall through to a short list of public gateways.
 *
 * IMPORTANT: we deliberately do NOT try a local Kubo gateway when a
 * Pinata JWT is configured. The local node doesn't have those CIDs, and
 * waiting for DHT discovery just stalls the UI.
 */

const env = import.meta.env;

const PINATA_JWT = (env.VITE_PINATA_JWT || "").trim();
const PINATA_GATEWAY_RAW = (env.VITE_PINATA_GATEWAY || "").trim();
const LOCAL_GATEWAY_RAW = (env.VITE_IPFS_GATEWAY || "").trim();

const ensureTrailingSlash = (gw) => (gw.endsWith("/") ? gw : gw + "/");

// Pinata's shared public gateway. Rate-limited but works without any
// config — good fallback for Pinata-pinned content.
const PINATA_SHARED = "https://gateway.pinata.cloud/ipfs/";

const PUBLIC_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
];

function buildGatewayList() {
  const seen = new Set();
  const ordered = [];
  const push = (gw) => {
    if (!gw) return;
    const norm = ensureTrailingSlash(gw);
    if (seen.has(norm)) return;
    seen.add(norm);
    ordered.push(norm);
  };

  // Case 1: Pinata JWT is configured → content lives on Pinata. Try
  // Pinata's gateway (dedicated if available, shared otherwise) FIRST.
  if (PINATA_JWT) {
    if (PINATA_GATEWAY_RAW) push(PINATA_GATEWAY_RAW);
    push(PINATA_SHARED);
    // Other public gateways are useful as "eventually consistent"
    // fallbacks in case Pinata's gateway has a temporary hiccup — the
    // CID is on the IPFS network, just might take a moment for other
    // gateways to fetch it.
    PUBLIC_GATEWAYS.forEach(push);
    return ordered;
  }

  // Case 2: no Pinata, but a local/custom gateway is configured → that's
  // where the user is pinning, so try it first.
  if (LOCAL_GATEWAY_RAW) {
    push(LOCAL_GATEWAY_RAW);
    PUBLIC_GATEWAYS.forEach(push);
    push(PINATA_SHARED);
    return ordered;
  }

  // Case 3: nothing configured — best-effort public gateways.
  PUBLIC_GATEWAYS.forEach(push);
  push(PINATA_SHARED);
  return ordered;
}

const GATEWAYS = buildGatewayList();

/**
 * Converts an `ipfs://…` (or bare CID) URI into a regular https URL that
 * browsers can fetch / render. Passes http(s) / data: / blob: URLs
 * through unchanged and returns `null` for empty input.
 */
export function ipfsToHttp(uri, gatewayIndex = 0) {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;

  if (/^(https?|data|blob):/i.test(trimmed)) return trimmed;

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

/**
 * Exposed for status UIs / debugging: describes where the app is
 * currently preferring to fetch IPFS content from.
 */
export function primaryGateway() {
  return GATEWAYS[0] || null;
}
