import { createContext, useContext, useEffect, useState } from "react";
import { formatEther } from "ethers";

/**
 * useCurrency
 * -----------
 * Keeps a live ETH → INR rate in-memory. On mount, tries CoinGecko's free
 * public price endpoint once. Falls back to a conservative static rate if
 * the fetch fails (offline dev, rate-limited, etc.) so the UI never shows
 * a "—" for price.
 *
 * The rate is cached in `sessionStorage` for the tab lifetime so subsequent
 * route changes don't refetch.
 */
const CACHE_KEY = "bp:eth-inr-rate";
const CACHE_TS_KEY = "bp:eth-inr-rate-ts";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const FALLBACK_INR_PER_ETH = 300000;  // ~₹3,00,000 / ETH (conservative default)

export function useCurrency() {
  const [rate, setRate] = useState(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      const ts = Number(sessionStorage.getItem(CACHE_TS_KEY) || 0);
      if (cached && Date.now() - ts < CACHE_TTL_MS) return Number(cached);
    } catch { /* ignore */ }
    return FALLBACK_INR_PER_ETH;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ts = Number(sessionStorage.getItem(CACHE_TS_KEY) || 0);
        if (Date.now() - ts < CACHE_TTL_MS) return;
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr",
          { headers: { accept: "application/json" } }
        );
        if (!res.ok) return;
        const data = await res.json();
        const inr = data?.ethereum?.inr;
        if (cancelled || !inr) return;
        setRate(Number(inr));
        try {
          sessionStorage.setItem(CACHE_KEY, String(inr));
          sessionStorage.setItem(CACHE_TS_KEY, String(Date.now()));
        } catch { /* ignore */ }
      } catch {
        /* keep fallback rate */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { rate };
}

// -- Context wrapper so the fetch happens once per app mount ------------
const CurrencyContext = createContext({ rate: FALLBACK_INR_PER_ETH });

export function CurrencyProvider({ children }) {
  const value = useCurrency();
  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useInrRate() {
  return useContext(CurrencyContext).rate;
}

/** Convert a wei bigint/string to INR using the current rate. */
export function weiToInr(wei, rate) {
  if (wei === null || wei === undefined) return 0;
  try {
    const eth = parseFloat(formatEther(wei));
    return eth * rate;
  } catch {
    return 0;
  }
}

/** Pretty-print INR using Indian digit grouping. Rupees only, no paise. */
export function formatINR(amount) {
  if (!Number.isFinite(amount)) return "₹0";
  const rounded = Math.round(amount);
  return "₹" + rounded.toLocaleString("en-IN");
}
