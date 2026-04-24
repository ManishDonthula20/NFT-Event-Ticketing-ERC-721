import { useState } from "react";
import {
  formatDate,
  formatETH,
  parseETH,
  isPast,
  humanizeError,
  bpsToPercent,
} from "../utils/helpers";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";

export default function TicketCard({
  ticket,
  contract,
  onAction,
  toast,
}) {
  const { tokenId, event, section, listing, valid } = ticket;
  const rate = useInrRate();
  const [showListModal, setShowListModal] = useState(false);
  const [priceEth, setPriceEth] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [busy, setBusy] = useState(false);

  const expired = isPast(event.date);
  const isListed = listing?.active;
  // Section price tells the holder what they actually paid; fall back to the
  // event-level aggregate if section data failed to load for some reason.
  const paidPriceWei = section?.priceWei ?? event.priceWei;

  const handleList = async () => {
    try {
      const wei = parseETH(priceEth);
      if (wei <= 0n) return toast.danger("Enter a valid price.");
      let expiresAt = 0;
      if (expiresDays) {
        const days = parseFloat(expiresDays);
        expiresAt = Math.floor(Date.now() / 1000) + Math.floor(days * 86400);
      }
      setBusy(true);
      toast.pending("Listing ticket…");
      await contract.listForResale(tokenId, wei, expiresAt);
      toast.success("Ticket listed for resale.");
      setShowListModal(false);
      setPriceEth("");
      setExpiresDays("");
      onAction?.();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    try {
      setBusy(true);
      toast.pending("Cancelling listing…");
      await contract.cancelResaleListing(tokenId);
      toast.success("Listing cancelled.");
      onAction?.();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <article className="card">
        <div className="flex justify-between items-center mb-8" style={{gap: 8, flexWrap: "wrap"}}>
          <div className="flex items-center" style={{gap: 8, flexWrap: "wrap"}}>
            <span className="tag neutral">Ticket</span>
            <span
              className="tag neutral"
              title="Show this token ID to the organiser at check-in"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: 0.2,
              }}
            >
              #{String(tokenId)}
            </span>
          </div>
          <div className="flex items-center" style={{gap: 6, flexWrap: "wrap"}}>
            {!valid   && <span className="tag green">Checked in</span>}
            {expired  && <span className="tag neutral">Past</span>}
            {isListed && <span className="tag green">Listed</span>}
          </div>
        </div>

        <h3 className="card-title" style={{marginBottom: 4}}>{event.name}</h3>
        <p className="muted" style={{fontSize: 13}}>
          {event.category} · {formatDate(event.date)}
        </p>

        {section?.name && (
          <div className="flex items-center gap-8 mt-8">
            <span className="tag green">Section: {section.name}</span>
          </div>
        )}

        <div
          className="flex justify-between items-center mt-16"
          style={{
            padding: "10px 12px",
            background: "var(--ink-50, #f4f6f8)",
            borderRadius: 8,
            gap: 12,
          }}
        >
          <div style={{fontSize: 12}}>
            <div className="muted" style={{marginBottom: 2}}>Token ID (show at check-in)</div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: 0.3,
              }}
            >
              #{String(tokenId)}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(String(tokenId));
                toast?.success?.(`Token ID #${tokenId} copied.`);
              } catch {
                toast?.danger?.("Could not copy token ID.");
              }
            }}
          >
            Copy
          </button>
        </div>

        <div className="price-row mt-16">
          <span className="label">Paid</span>
          <span className="value">
            {formatETH(paidPriceWei)}
            <span className="unit">ETH</span>
          </span>
        </div>
        <div className="flex justify-end" style={{fontSize: 12, color: "var(--ink-500)"}}>
          ≈ {formatINR(weiToInr(paidPriceWei, rate))}
        </div>

        {isListed && (
          <div className="alert info mt-16">
            Listed at <b>&nbsp;{formatETH(listing.price)} ETH</b>
            {" "}(≈ {formatINR(weiToInr(listing.price, rate))})
            {listing.expiresAt > 0 && (
              <> · expires {formatDate(listing.expiresAt)}</>
            )}
          </div>
        )}

        <div className="event-actions mt-16">
          {isListed ? (
            <button
              className="btn btn-ghost btn-block"
              onClick={handleCancel}
              disabled={busy}
            >
              Cancel listing
            </button>
          ) : (
            <button
              className="btn btn-accent btn-block"
              onClick={() => setShowListModal(true)}
              disabled={busy || expired || !valid || event.cancelled}
            >
              List for resale
            </button>
          )}
        </div>
      </article>

      {showListModal && (
        <div className="modal-backdrop" onClick={() => setShowListModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>List ticket for resale</h3>
            <p className="muted" style={{fontSize: 13, marginBottom: 18}}>
              On sale, {bpsToPercent(event.royaltyBps)}% royalty goes to the
              organiser. You receive the remainder.
            </p>

            <div className="form-grid">
              <div className="field">
                <label>Resale price (ETH)</label>
                <input
                  type="number" step="0.001" min="0"
                  value={priceEth}
                  onChange={(e) => setPriceEth(e.target.value)}
                  placeholder="0.15"
                />
              </div>
              <div className="field">
                <label>Expires in (days, optional)</label>
                <input
                  type="number" step="1" min="0"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="7"
                />
                <div className="hint">Must be before event date.</div>
              </div>
            </div>

            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setShowListModal(false)}>
                Cancel
              </button>
              <button className="btn btn-accent" onClick={handleList} disabled={busy}>
                {busy ? "Listing…" : "Confirm listing"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
