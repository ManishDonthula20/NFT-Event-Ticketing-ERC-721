import { useState } from "react";
import {
  formatDate,
  formatETH,
  humanizeError,
  bpsToPercent,
  calculateRoyalty,
  calculateSellerAmount,
  isSameAddress,
  isPast,
} from "../utils/helpers";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";

export default function ListingCard({
  event,
  section,
  tokenId,
  seller,
  expiresAt,
  price,
  contract,
  account,
  onAction,
  toast,
}) {
  const [busy, setBusy] = useState(false);
  const rate = useInrRate();
  const isOwnListing = isSameAddress(seller, account);
  const expired = expiresAt > 0 && expiresAt * 1000 < Date.now();
  const eventPast = isPast(event.date);
  const canBuy = !isOwnListing && !expired && !eventPast && !event.cancelled;

  const handleBuy = async () => {
    try {
      setBusy(true);
      toast.pending("Purchasing ticket…");
      await contract.buyResaleTicket(tokenId, price);
      toast.success("Ticket purchased.");
      onAction?.();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const royalty = calculateRoyalty(price, event.royaltyBps);
  const sellerAmt = calculateSellerAmount(price, event.royaltyBps);

  return (
    <article className="card">
      <div className="flex justify-between items-center mb-8" style={{gap: 8, flexWrap: "wrap"}}>
        <span className="tag neutral">Resale</span>
        {section?.name && <span className="tag green">{section.name}</span>}
        {event.cancelled && <span className="tag red">Event cancelled</span>}
        {eventPast && <span className="tag neutral">Past</span>}
        {expired && <span className="tag amber">Listing expired</span>}
      </div>

      <h3 className="card-title" style={{marginBottom: 4}}>{event.name}</h3>
      <p className="muted" style={{fontSize: 13}}>
        {event.category} · {formatDate(event.date)}
        {section?.name && <> · Section <b>{section.name}</b></>}
      </p>

      <div className="price-row mt-16">
        <span className="label">Asking price</span>
        <span className="value">
          {formatETH(price)} <span className="unit">ETH</span>
        </span>
      </div>
      <div className="flex justify-end" style={{fontSize: 12, color: "var(--ink-500)"}}>
        ≈ {formatINR(weiToInr(price, rate))}
      </div>

      <div className="flex justify-between mt-8" style={{fontSize: 12, color: "var(--ink-500)"}}>
        <span>Royalty ({bpsToPercent(event.royaltyBps)}%)</span>
        <span>{formatETH(royalty, 5)} ETH → organiser</span>
      </div>
      <div className="flex justify-between" style={{fontSize: 12, color: "var(--ink-500)"}}>
        <span>Seller receives</span>
        <span>{formatETH(sellerAmt, 5)} ETH</span>
      </div>

      {expiresAt > 0 && !expired && (
        <p className="muted mt-8" style={{fontSize: 12}}>
          Listing expires {formatDate(expiresAt)}.
        </p>
      )}

      <div className="event-actions mt-16">
        {isOwnListing ? (
          <button className="btn btn-ghost btn-block" disabled>
            Your listing
          </button>
        ) : (
          <button
            className="btn btn-accent btn-block"
            onClick={handleBuy}
            disabled={busy || !canBuy}
          >
            {busy ? "Processing…" : canBuy ? "Buy this ticket" : "Unavailable"}
          </button>
        )}
      </div>
    </article>
  );
}
