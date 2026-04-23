import { useEffect, useState } from "react";
import { ipfsGatewayUrls, isLikelyImageUri } from "../utils/ipfs";

/**
 * Fetches an event's off-chain metadata document from IPFS.
 *
 * Behaviour:
 *  - Empty / falsy URI → returns `{ data: null }` (no fetch attempted).
 *  - URI that looks like a direct image file (.png, .jpg, …) → returns
 *    a synthetic `{ image: <uri> }` document so the poster still renders
 *    without a JSON indirection step.
 *  - Otherwise we try each public gateway in turn until one successfully
 *    returns parseable JSON. Whatever shape the organiser uploaded is
 *    returned verbatim; rendering code picks out the fields it cares
 *    about (`name`, `description`, `image`, `attributes`, …).
 *  - Results are cached in a module-level `Map` keyed by URI so every
 *    EventCard showing the same event doesn't refetch.
 */

const cache = new Map(); // uri -> metadata document (or `null` for failure)
const inflight = new Map(); // uri -> Promise<metadata>

async function fetchMetadata(uri) {
  if (isLikelyImageUri(uri)) {
    return { image: uri };
  }

  const urls = ipfsGatewayUrls(uri);
  let lastError;
  for (const url of urls) {
    try {
      // 8 s timeout — gateways that hang shouldn't pin the UI.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // Not JSON. If the gateway returned an image, fall back to
        // a synthetic metadata doc pointing at the original URI so
        // the browser will load it through its own gateway choice.
        const ct = res.headers.get("content-type") || "";
        if (ct.startsWith("image/")) return { image: uri };
        lastError = new Error(`Non-JSON response from ${url} (${ct})`);
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("All IPFS gateways failed");
}

export function useIpfsMetadata(uri) {
  const [data, setData] = useState(() => (uri ? cache.get(uri) ?? null : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uri) {
      setData(null);
      setError(null);
      return;
    }
    if (cache.has(uri)) {
      setData(cache.get(uri));
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // De-dupe concurrent fetches for the same URI across component mounts.
    let promise = inflight.get(uri);
    if (!promise) {
      promise = fetchMetadata(uri)
        .then((meta) => {
          cache.set(uri, meta);
          return meta;
        })
        .finally(() => {
          inflight.delete(uri);
        });
      inflight.set(uri, promise);
    }

    promise
      .then((meta) => {
        if (!cancelled) setData(meta);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load metadata");
        cache.set(uri, null); // negative-cache so we don't keep retrying
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return { data, loading, error };
}
