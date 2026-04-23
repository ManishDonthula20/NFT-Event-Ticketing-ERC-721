import { useState, useEffect, useCallback, useRef } from "react";
import { BrowserProvider } from "ethers";
import { CHAIN_ID, NETWORK_NAME } from "../utils/contract";

/**
 * Wallet hook with session persistence across page reloads.
 *
 * "Session" here means: if the user previously clicked Connect and has not
 * explicitly disconnected, we silently re-attach on mount via `eth_accounts`
 * — a read-only RPC that does NOT prompt MetaMask. No user interaction is
 * required and no signatures are produced.
 *
 * If the user clicked Disconnect (or MetaMask revoked the site's permissions),
 * we remember that and skip the silent re-attach until they Connect again.
 */
const CONNECT_INTENT_KEY = "bp:wallet-connect-intent";

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(
    () => typeof window !== "undefined" &&
          window.localStorage?.getItem(CONNECT_INTENT_KEY) === "1"
  );
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);

  // Keep a ref to the current provider so the event listeners in the
  // long-lived `useEffect` below can read the latest value without
  // re-subscribing every time provider changes.
  const providerRef = useRef(null);
  useEffect(() => { providerRef.current = provider; }, [provider]);

  const isConnected = !!account;
  const isCorrectNetwork = chainId === CHAIN_ID;

  /** Refresh ETH balance for current account. */
  const refreshBalance = useCallback(
    async (addr, p) => {
      const a = addr ?? account;
      const prov = p ?? providerRef.current;
      if (!a || !prov) return;
      try {
        const bal = await prov.getBalance(a);
        setBalance(bal);
      } catch {
        /* ignore */
      }
    },
    [account]
  );

  /** Shared plumbing: given an address, hydrate provider/signer/chain/balance. */
  const hydrate = useCallback(async (addr) => {
    const browserProvider = new BrowserProvider(window.ethereum);
    const [network, sgnr] = await Promise.all([
      browserProvider.getNetwork(),
      browserProvider.getSigner(),
    ]);
    setProvider(browserProvider);
    providerRef.current = browserProvider;
    setSigner(sgnr);
    setAccount(addr);
    setChainId(Number(network.chainId));
    try {
      const bal = await browserProvider.getBalance(addr);
      setBalance(bal);
    } catch {
      /* ignore */
    }
  }, []);

  /** Explicit connect: triggers MetaMask account picker. */
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed. Install it to continue.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      try {
        await window.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        /* older MetaMask versions may not support this — fall through */
      }
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accounts.length) throw new Error("No accounts returned");

      await hydrate(accounts[0]);
      // Remember intent so we auto-restore on the next page load.
      window.localStorage?.setItem(CONNECT_INTENT_KEY, "1");
    } catch (e) {
      setError(e.message || "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  }, [hydrate]);

  /** Clears local wallet state (does not revoke MetaMask permissions). */
  const disconnect = useCallback(() => {
    setAccount(null);
    setProvider(null);
    providerRef.current = null;
    setSigner(null);
    setChainId(null);
    setBalance(null);
    setError(null);
    window.localStorage?.removeItem(CONNECT_INTENT_KEY);
  }, []);

  /** Switch MetaMask to the configured chain, or add it if missing. */
  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const hex = `0x${CHAIN_ID.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }],
      });
    } catch (err) {
      // 4902 = chain not known to the wallet yet. Only the local Hardhat
      // chain actually needs to be added manually; every public chain
      // (Sepolia, mainnet, …) is already present in every modern wallet,
      // so we only supply add-params for the local dev network.
      if (err.code === 4902 && CHAIN_ID === 31337) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hex,
              chainName: NETWORK_NAME,
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["http://127.0.0.1:8545"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }, []);

  // --- Session restore on mount -----------------------------------------
  // If the user previously connected (intent flag set) AND MetaMask still
  // holds the permission (eth_accounts returns a non-empty list), attach
  // silently — no prompt, no signature, just a provider/signer rebuild.
  useEffect(() => {
    if (!window.ethereum) {
      setIsRestoring(false);
      return;
    }
    if (window.localStorage?.getItem(CONNECT_INTENT_KEY) !== "1") {
      setIsRestoring(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const accounts = await window.ethereum.request({
          method: "eth_accounts",
        });
        if (cancelled) return;
        if (!accounts?.length) {
          // Permissions revoked outside our UI — drop the stale intent.
          window.localStorage?.removeItem(CONNECT_INTENT_KEY);
          return;
        }
        await hydrate(accounts[0]);
      } catch {
        /* ignore — user can click Connect manually */
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrate]);

  // --- Live wallet events -----------------------------------------------
  // Subscribed ONCE on mount. Uses providerRef so we don't have to re-bind
  // every time `provider` state changes (that caused listener churn before).
  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = async (accounts) => {
      if (!accounts.length) {
        disconnect();
        return;
      }
      // Rehydrate signer against the new active account.
      try {
        await hydrate(accounts[0]);
      } catch {
        setAccount(accounts[0]);
      }
    };

    const onChainChanged = (hex) => {
      setChainId(parseInt(hex, 16));
      // Full reload avoids stale provider/signer problems. Intent flag
      // keeps the wallet attached automatically after the reload.
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [disconnect, hydrate]);

  return {
    account,
    provider,
    signer,
    chainId,
    balance,
    isConnected,
    isConnecting,
    isRestoring,
    isCorrectNetwork,
    error,
    connect,
    disconnect,
    switchNetwork,
    refreshBalance,
  };
}
