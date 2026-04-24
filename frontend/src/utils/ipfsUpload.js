/**
 * In-app IPFS uploads.
 *
 * This module lets the app accept a file / blob directly from an organiser
 * and push it to IPFS without any external tooling. We try two backends:
 *
 *   1. Pinata (preferred when a JWT is configured)
 *      — set VITE_PINATA_JWT in `frontend/.env` to enable. Pinata pins the
 *        file on its public IPFS cluster and returns a CID that anyone on
 *        the internet can fetch through our public gateway list.
 *
 *   2. Kubo-compatible local IPFS daemon (dev fallback)
 *      — if you run `ipfs daemon` (Kubo / IPFS Desktop) on port 5001, the
 *        upload posts to its `/api/v0/add` endpoint. CORS has to allow the
 *        dev server origin; `ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:5173"]'`
 *        gets you there.
 *
 * If neither is configured / reachable, we throw an error the UI can show
 * — no silent fallback to "fake" CIDs.
 */

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT || "";
const PINATA_API = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_API = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const LOCAL_IPFS_API =
  import.meta.env.VITE_IPFS_API || "http://127.0.0.1:5001";

/** True if any IPFS backend is at least configured. */
export function ipfsUploadEnabled() {
  return Boolean(PINATA_JWT) || Boolean(LOCAL_IPFS_API);
}

/** Human-readable short summary of which backend(s) are configured. */
export function ipfsUploadStatus() {
  if (PINATA_JWT) return "Pinata";
  if (LOCAL_IPFS_API) return `local node at ${LOCAL_IPFS_API}`;
  return "not configured";
}

/**
 * Upload a binary blob (File / Blob) to IPFS and return its CID.
 */
export async function uploadFile(file) {
  if (!file) throw new Error("No file provided");

  if (PINATA_JWT) {
    const form = new FormData();
    form.append("file", file, file.name || "upload");
    const res = await fetch(PINATA_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinata upload failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (!data.IpfsHash) throw new Error("Pinata response missing IpfsHash");
    return data.IpfsHash;
  }

  // Kubo / local IPFS daemon fallback.
  const form = new FormData();
  form.append("file", file, file.name || "upload");
  const res = await fetch(`${LOCAL_IPFS_API}/api/v0/add?pin=true&cid-version=1`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      `Local IPFS upload failed (${res.status}). Start a Kubo daemon or set VITE_PINATA_JWT.`
    );
  }
  // Kubo returns one JSON object per file, newline-separated.
  const text = await res.text();
  const lastLine = text.trim().split("\n").pop();
  const json = JSON.parse(lastLine);
  if (!json.Hash) throw new Error("Local IPFS response missing Hash");
  return json.Hash;
}

/**
 * Upload a JSON object to IPFS. Preferred path for event metadata docs
 * so the CID reflects the actual content rather than the file name.
 */
export async function uploadJSON(obj) {
  if (PINATA_JWT) {
    const res = await fetch(PINATA_JSON_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({ pinataContent: obj }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Pinata JSON upload failed: ${res.status} ${text}`);
    }
    const data = await res.json();
    if (!data.IpfsHash) throw new Error("Pinata response missing IpfsHash");
    return data.IpfsHash;
  }

  // Fallback: serialise and reuse the file uploader.
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const fakeFile = new File([blob], "metadata.json", { type: "application/json" });
  return await uploadFile(fakeFile);
}

/** Build the ipfs://<cid> URI our on-chain metadataURI field expects. */
export function toIpfsUri(cid) {
  if (!cid) return "";
  if (cid.startsWith("ipfs://")) return cid;
  return `ipfs://${cid}`;
}
