import { formatEther, parseEther } from "ethers";

export const formatETH = (wei, digits = 4) => {
  if (wei === null || wei === undefined) return "0";
  try {
    return parseFloat(formatEther(wei)).toFixed(digits).replace(/\.?0+$/, "");
  } catch {
    return "0";
  }
};

export const parseETH = (eth) => {
  if (!eth) return 0n;
  return parseEther(eth.toString());
};

export const truncateAddress = (addr, head = 6, tail = 4) => {
  if (!addr) return "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
};

export const bpsToPercent = (bps) => (bps ? Number(bps) / 100 : 0);

export const percentToBps = (percent) =>
  percent ? Math.round(Number(percent) * 100) : 0;

export const calculateRoyalty = (priceWei, royaltyBps) => {
  if (!priceWei || !royaltyBps) return 0n;
  return (BigInt(priceWei) * BigInt(royaltyBps)) / 10_000n;
};

export const calculateSellerAmount = (priceWei, royaltyBps) => {
  const royalty = calculateRoyalty(priceWei, royaltyBps);
  return BigInt(priceWei) - royalty;
};

export const formatDate = (unix) => {
  const ms = Number(unix) * 1000;
  const d = new Date(ms);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const formatDateTime = (unix) => {
  const ms = Number(unix) * 1000;
  const d = new Date(ms);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const relativeTime = (unix) => {
  const diff = Number(unix) * 1000 - Date.now();
  const abs = Math.abs(diff);
  const sign = diff >= 0 ? "in" : "ago";
  const units = [
    { s: 86400000 * 365, n: "year" },
    { s: 86400000 * 30, n: "month" },
    { s: 86400000, n: "day" },
    { s: 3600000, n: "hour" },
    { s: 60000, n: "minute" },
  ];
  for (const u of units) {
    if (abs >= u.s) {
      const v = Math.floor(abs / u.s);
      return sign === "in"
        ? `in ${v} ${u.n}${v > 1 ? "s" : ""}`
        : `${v} ${u.n}${v > 1 ? "s" : ""} ago`;
    }
  }
  return sign === "in" ? "soon" : "just now";
};

export const isPast = (unix) => Number(unix) * 1000 < Date.now();

export const ticketsRemaining = (maxTickets, ticketsSold) =>
  Number(maxTickets) - Number(ticketsSold);

export const soldOut = (maxTickets, ticketsSold) =>
  Number(ticketsSold) >= Number(maxTickets);

export const isSameAddress = (a, b) =>
  (a || "").toLowerCase() === (b || "").toLowerCase();

/**
 * Friendly error messages from ethers / MetaMask errors.
 *
 * Note on "missing revert data": ethers emits this when a call reverts
 * but the upstream JSON-RPC provider stripped the revert reason from
 * its response (common on public estimateGas endpoints). We dig into
 * the various places the reason might still be hiding before giving
 * up with a generic hint.
 */
export const humanizeError = (err) => {
  if (!err) return "Unknown error";
  if (err.code === "ACTION_REJECTED" || err.code === 4001)
    return "Transaction rejected in wallet.";

  // ethers v6 decodes string/custom reverts into err.revert when it can
  const revertReason = err.revert?.args?.[0];
  if (typeof revertReason === "string" && revertReason.length > 0)
    return revertReason;

  // Some providers nest the real JSON-RPC error under err.info or err.error
  const nested =
    err.info?.error?.message ||
    err.error?.message ||
    err.data?.message ||
    null;
  const candidateMessages = [
    err.reason,
    err.shortMessage,
    nested,
    err.message,
  ].filter(Boolean);

  for (const msg of candidateMessages) {
    if (typeof msg !== "string") continue;
    if (msg.includes("insufficient funds"))
      return "Insufficient ETH balance for this transaction.";
    if (msg.includes("could not decode"))
      return "Contract not found on this network. Please deploy it first.";
    // `execution reverted: "…"` or `execution reverted with reason string '…'`
    const revertMatch =
      msg.match(/execution reverted:\s*"?([^"]+?)"?$/i) ||
      msg.match(/reverted with reason string ['"]([^'"]+)['"]/i) ||
      msg.match(/reason="([^"]+)"/);
    if (revertMatch) return revertMatch[1];
  }

  // RPC stripped the revert reason — give the user something actionable
  // instead of the raw "missing revert data" string.
  const joined = candidateMessages.join(" ").toLowerCase();
  if (joined.includes("missing revert data") || err.code === "CALL_EXCEPTION") {
    return (
      "Transaction would fail on-chain. A contract precondition wasn't met " +
      "(e.g. price/royalty can't change after the first sale, date must be " +
      ">1 day away, or the value is outside allowed bounds). Double-check " +
      "your inputs and try again."
    );
  }

  return candidateMessages[0] || "Transaction failed.";
};
