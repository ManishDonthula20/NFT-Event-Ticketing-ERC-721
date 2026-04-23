import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  formatDate,
  formatDateTime,
  formatETH,
  truncateAddress,
  humanizeError,
  bpsToPercent,
  ticketsRemaining,
  isPast,
  isSameAddress,
} from "../utils/helpers";
import { ipfsToHttp, ipfsGatewayUrls } from "../utils/ipfs";
import { useIpfsMetadata } from "../hooks/useIpfsMetadata";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";

export default function EventDetails({ contract, account, isConnected, connect, toast, bump }) {
  const { id } = useParams();
  const eventId = Number(id);
  const navigate = useNavigate();
  const rate = useInrRate();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bought, setBought] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);

  const { data: meta, loading: metaLoading } = useIpfsMetadata(event?.metadataURI);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await contract.getEvent(eventId);
      if (!ev) return;
      setEvent(ev);
      if (account) {
        setBought(await contract.ticketsBoughtBy(account, eventId));
      } else {
        setBought(0);
      }
    } catch {
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [contract, eventId, account]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="card">
        <div className="skel" style={{ height: 36, width: "50%", marginBottom: 12 }} />
        <div className="skel" style={{ height: 14, width: "80%", marginBottom: 6 }} />
        <div className="skel" style={{ height: 14, width: "60%", marginBottom: 20 }} />
        <div className="skel" style={{ height: 100, width: "100%" }} />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="empty">
        <h3>Event not found</h3>
        <p>The event ID you requested does not exist on-chain.</p>
        <Link to="/" className="btn btn-primary">Browse events</Link>
      </div>
    );
  }

  const remaining = ticketsRemaining(event.maxTickets, event.ticketsSold);
  const expired   = isPast(event.date);
  const userCapLeft = Math.max(0, event.maxPerBuyer - bought);
  const maxBuyable  = Math.min(userCapLeft, remaining);

  const totalPriceWei = BigInt(event.priceWei) * BigInt(quantity);

  const handleBuy = async () => {
    if (!isConnected) { await connect(); return; }
    try {
      setBusy(true);
      toast.pending(`Buying ${quantity} ticket${quantity > 1 ? "s" : ""}…`);
      if (quantity === 1) {
        await contract.buyTicket(eventId, event.priceWei);
      } else {
        await contract.buyMultipleTickets(eventId, quantity, event.priceWei);
      }
      toast.success("Ticket purchased. Check 'My Tickets'.");
      bump?.();
      navigate("/my-tickets");
      return;
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    event.cancelled ||
    expired ||
    remaining === 0 ||
    userCapLeft === 0;

  let reason = null;
  if (event.cancelled) reason = "Event has been cancelled";
  else if (expired) reason = "Event date has passed";
  else if (remaining === 0) reason = "Sold out";
  else if (userCapLeft === 0) reason = "You have reached the per-buyer cap";

  return (
    <div>
      <Link to="/" className="muted" style={{fontSize: 13}}>← Back to events</Link>

      <div className="hero" style={{marginTop: 8}}>
        <p className="eyebrow">
          {event.category || "Event"}
          {event.cancelled && " · Cancelled"}
          {expired && !event.cancelled && " · Past"}
        </p>
        <h1>{event.name}</h1>
        <p className="lead mt-16">
          {formatDateTime(event.date)} · Organised by{" "}
          <span className="mono" style={{fontSize: "0.9em"}}>
            {truncateAddress(event.organiser)}
          </span>
          {isSameAddress(event.organiser, account) && " (you)"}
        </p>
      </div>

      <div className="grid" style={{gridTemplateColumns: "2fr 1fr", gap: 24, alignItems: "start"}}>
        {/* Left: details */}
        <div className="flex-col gap-24">
          <EventPoster metadataURI={event.metadataURI} meta={meta} metaLoading={metaLoading} alt={event.name} />

          {meta?.description && (
            <div className="card">
              <h2 style={{fontSize: "1.3rem", marginBottom: 12}}>About this event</h2>
              <p style={{whiteSpace: "pre-wrap", color: "var(--ink-700)", lineHeight: 1.7}}>
                {meta.description}
              </p>
            </div>
          )}

          <div className="card">
            <h2 style={{fontSize: "1.3rem", marginBottom: 12}}>Details</h2>
            <dl className="mt-16" style={{display: "grid", gridTemplateColumns: "1fr 2fr", rowGap: 10, columnGap: 20, fontSize: 14}}>
              <dt className="muted">Date</dt>
              <dd>{formatDate(event.date)}</dd>
              <dt className="muted">Category</dt>
              <dd>{event.category || "—"}</dd>
              <dt className="muted">Resale royalty</dt>
              <dd>{bpsToPercent(event.royaltyBps)}% to organiser</dd>
              <dt className="muted">Per-buyer limit</dt>
              <dd>{event.maxPerBuyer} ticket{event.maxPerBuyer > 1 ? "s" : ""}</dd>
              <dt className="muted">Organiser</dt>
              <dd className="mono" style={{fontSize: "0.9em"}}>{truncateAddress(event.organiser)}</dd>
              {event.metadataURI && (
                <>
                  <dt className="muted">Metadata</dt>
                  <dd style={{overflowWrap: "anywhere"}}>
                    <a href={ipfsToHttp(event.metadataURI)} target="_blank" rel="noopener noreferrer">
                      View on IPFS
                    </a>
                    <span className="muted mono" style={{fontSize: "0.85em", marginLeft: 8}}>
                      {event.metadataURI}
                    </span>
                  </dd>
                </>
              )}
            </dl>
          </div>

          {Array.isArray(meta?.attributes) && meta.attributes.length > 0 && (
            <div className="card">
              <h2 style={{fontSize: "1.3rem", marginBottom: 12}}>Extras</h2>
              <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14}}>
                {meta.attributes.map((a, i) => (
                  <div key={i}>
                    <div className="muted" style={{fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 2}}>
                      {a.trait_type || "Attribute"}
                    </div>
                    <div style={{fontSize: 14}}>{String(a.value ?? "")}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: purchase box */}
        <aside className="card" style={{position: "sticky", top: 90}}>
          <div className="price-row" style={{borderTop: "none", paddingTop: 0}}>
            <span className="label">Price per ticket</span>
            <span className="value">{formatETH(event.priceWei)}<span className="unit">ETH</span></span>
          </div>
          <div className="flex justify-end" style={{fontSize: 12, color: "var(--ink-500)", marginTop: -4}}>
            ≈ {formatINR(weiToInr(event.priceWei, rate))}
          </div>

          <div className="flex justify-between mt-16 mb-8" style={{fontSize: 13}}>
            <span className="muted">Available</span>
            <span>{remaining} / {event.maxTickets}</span>
          </div>
          <div className="flex justify-between mb-16" style={{fontSize: 13}}>
            <span className="muted">You can buy</span>
            <span>{userCapLeft} more</span>
          </div>

          {!disabled && (
            <div className="field mb-16">
              <label>Quantity</label>
              <div className="flex items-center gap-12">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                >
                  −
                </button>
                <span style={{fontFamily: "var(--serif)", fontSize: "1.5rem", minWidth: 30, textAlign: "center"}}>
                  {quantity}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setQuantity((q) => Math.min(maxBuyable, q + 1))}
                  disabled={quantity >= maxBuyable}
                >
                  +
                </button>
                <span className="muted" style={{fontSize: 12, marginLeft: "auto"}}>
                  max {maxBuyable}
                </span>
              </div>
            </div>
          )}

          <div className="price-row">
            <span className="label">Total</span>
            <span className="value">{formatETH(totalPriceWei)}<span className="unit">ETH</span></span>
          </div>
          <div className="flex justify-end mb-16" style={{fontSize: 12, color: "var(--ink-500)"}}>
            ≈ {formatINR(weiToInr(totalPriceWei, rate))}
          </div>

          {reason && (
            <div className="alert warn mb-16">{reason}</div>
          )}

          <button
            className="btn btn-accent btn-block btn-lg"
            onClick={handleBuy}
            disabled={disabled}
          >
            {busy
              ? "Confirm in wallet…"
              : !isConnected
              ? "Connect wallet to buy"
              : reason
              ? reason
              : `Buy ${quantity > 1 ? quantity + " tickets" : "ticket"}`}
          </button>

          {isSameAddress(event.organiser, account) && (
            <button
              className="btn btn-ghost btn-block mt-16"
              onClick={() => navigate("/organise")}
            >
              Manage this event
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Poster banner that tries every public IPFS gateway before giving up.
 * We walk through the list on `onError` so a slow / failed primary
 * gateway quietly falls back to the next one.
 */
function EventPoster({ metadataURI, meta, metaLoading, alt }) {
  const imageUri = meta?.image;
  const gateways = imageUri ? ipfsGatewayUrls(imageUri) : [];
  const [gwIdx, setGwIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!metadataURI) return null;

  if (metaLoading && !imageUri) {
    return (
      <div className="card" style={{padding: 0, overflow: "hidden"}}>
        <div className="skel" style={{aspectRatio: "16 / 9", width: "100%"}} />
      </div>
    );
  }

  if (!imageUri || failed || gateways.length === 0) {
    // No image in metadata — nothing to render.
    return null;
  }

  return (
    <div className="card" style={{padding: 0, overflow: "hidden"}}>
      <img
        src={gateways[gwIdx]}
        alt={alt}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: "16 / 9",
          objectFit: "cover",
          background: "var(--surface-alt)",
        }}
        onError={() => {
          if (gwIdx + 1 < gateways.length) setGwIdx(gwIdx + 1);
          else setFailed(true);
        }}
      />
    </div>
  );
}
