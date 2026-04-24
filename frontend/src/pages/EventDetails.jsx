import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  formatDate,
  formatDateTime,
  formatETH,
  humanizeError,
  bpsToPercent,
  ticketsRemaining,
  isPast,
  isSameAddress,
} from "../utils/helpers";
import { ipfsGatewayUrls } from "../utils/ipfs";
import { useIpfsMetadata, getMetadata } from "../hooks/useIpfsMetadata";
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
  const [selectedSection, setSelectedSection] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data: meta, loading: metaLoading } = useIpfsMetadata(event?.metadataURI);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await contract.getEvent(eventId);
      if (!ev) return;
      // Merge the event's IPFS metadata so the page can display name,
      // description, category, section labels etc. even though the contract
      // no longer stores them.
      const metaDoc = await getMetadata(ev.metadataURI).catch(() => null);
      const sectionLabels = Array.isArray(metaDoc?.sections) ? metaDoc.sections : [];
      setEvent({
        ...ev,
        name: metaDoc?.name || `Event #${ev.id}`,
        description: metaDoc?.description || "",
        category: metaDoc?.category || "",
        image: metaDoc?.image || null,
        sections: ev.sections.map((s, i) => ({
          ...s,
          name: sectionLabels[i]?.name || s.name || `Section ${i + 1}`,
        })),
      });
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

  // Pick the first section that still has tickets when the event loads or
  // when the current selection runs out of inventory.
  useEffect(() => {
    if (!event?.sections?.length) return;
    const available = event.sections.findIndex(
      (s) => s.ticketsSold < s.maxTickets
    );
    const current = event.sections[selectedSection];
    const currentAvail =
      current && current.ticketsSold < current.maxTickets;
    if (!currentAvail && available >= 0) {
      setSelectedSection(available);
      setQuantity(1);
    }
  }, [event, selectedSection]);

  const section = event?.sections?.[selectedSection] || null;

  const sectionRemaining = section
    ? ticketsRemaining(section.maxTickets, section.ticketsSold)
    : 0;
  const eventRemaining = event
    ? ticketsRemaining(event.maxTickets, event.ticketsSold)
    : 0;
  const expired = event ? isPast(event.date) : false;
  const userCapLeft = event ? Math.max(0, event.maxPerBuyer - bought) : 0;
  const maxBuyable = Math.min(userCapLeft, sectionRemaining);

  const unitPrice = section ? BigInt(section.priceWei) : 0n;
  const totalPriceWei = unitPrice * BigInt(quantity || 0);

  // Keep quantity inside the [1, maxBuyable] window when switching sections.
  useEffect(() => {
    if (quantity > maxBuyable && maxBuyable >= 1) setQuantity(maxBuyable);
    if (quantity < 1 && maxBuyable >= 1) setQuantity(1);
  }, [maxBuyable, quantity]);

  const handleBuy = async () => {
    if (!isConnected) { await connect(); return; }
    if (!section) return;
    try {
      setBusy(true);
      toast.pending(
        `Buying ${quantity} ${section.name} ticket${quantity > 1 ? "s" : ""}…`
      );
      if (quantity === 1) {
        await contract.buyTicket(eventId, section.id, unitPrice);
      } else {
        await contract.buyMultipleTickets(
          eventId,
          section.id,
          quantity,
          unitPrice
        );
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

  const disabled =
    busy ||
    event.cancelled ||
    expired ||
    !section ||
    sectionRemaining === 0 ||
    userCapLeft === 0;

  let reason = null;
  if (event.cancelled) reason = "Event has been cancelled";
  else if (expired) reason = "Event date has passed";
  else if (eventRemaining === 0) reason = "Sold out";
  else if (!section) reason = "No sections available";
  else if (sectionRemaining === 0) reason = "This section is sold out";
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
          {formatDateTime(event.date)}
          {isSameAddress(event.organiser, account) && " · Organised by you"}
        </p>
      </div>

      <div className="grid" style={{gridTemplateColumns: "2fr 1fr", gap: 24, alignItems: "start"}}>
        {/* Left: details */}
        <div className="flex-col gap-24">
          <EventPoster
            metadataURI={event.metadataURI}
            meta={meta}
            metaLoading={metaLoading}
            alt={event.name}
            category={event.category}
          />

          {(event.description || meta?.description) && (
            <div className="card">
              <h2 style={{fontSize: "1.3rem", marginBottom: 12}}>About this event</h2>
              <p style={{whiteSpace: "pre-wrap", color: "var(--ink-700)", lineHeight: 1.7}}>
                {event.description || meta?.description}
              </p>
            </div>
          )}

          <div className="card">
            <h2 style={{fontSize: "1.3rem", marginBottom: 12}}>Sections</h2>
            <div className="aside" style={{marginBottom: 12}}>
              Choose the section you'd like to buy from.
            </div>
            <div className="flex-col gap-8">
              {event.sections?.map((s) => {
                const remaining = ticketsRemaining(s.maxTickets, s.ticketsSold);
                const isSoldOut = remaining === 0;
                const selected = selectedSection === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    className="card interactive"
                    onClick={() => !isSoldOut && setSelectedSection(s.id)}
                    disabled={isSoldOut || expired || event.cancelled}
                    style={{
                      textAlign: "left",
                      padding: 14,
                      border: selected
                        ? "2px solid var(--accent, #6366f1)"
                        : "1px solid var(--border)",
                      opacity: isSoldOut ? 0.55 : 1,
                      cursor: isSoldOut ? "not-allowed" : "pointer",
                      background: selected ? "var(--surface-alt)" : "var(--surface)",
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div style={{fontWeight: 600}}>{s.name}</div>
                        <div className="muted" style={{fontSize: 12}}>
                          {remaining} / {s.maxTickets} available
                          {isSoldOut && " · sold out"}
                        </div>
                      </div>
                      <div style={{textAlign: "right"}}>
                        <div style={{fontFamily: "var(--serif)", fontSize: "1.1rem"}}>
                          {formatETH(s.priceWei)}{" "}
                          <span className="unit">ETH</span>
                        </div>
                        <div className="muted" style={{fontSize: 11}}>
                          ≈ {formatINR(weiToInr(s.priceWei, rate))}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

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
              <dd>
                {event.maxPerBuyer} ticket{event.maxPerBuyer > 1 ? "s" : ""}{" "}
                <span className="muted">(across all sections)</span>
              </dd>
              <dt className="muted">Available now</dt>
              <dd>
                {ticketsRemaining(event.maxTickets, event.ticketsSold)} of{" "}
                {event.maxTickets} tickets
              </dd>
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
          <div className="flex justify-between items-center mb-8">
            <span className="muted" style={{fontSize: 12}}>Selected section</span>
            <span className="tag neutral">{section?.name || "—"}</span>
          </div>
          <div className="price-row" style={{borderTop: "none", paddingTop: 0}}>
            <span className="label">Price per ticket</span>
            <span className="value">
              {formatETH(unitPrice)}
              <span className="unit">ETH</span>
            </span>
          </div>
          <div className="flex justify-end" style={{fontSize: 12, color: "var(--ink-500)", marginTop: -4}}>
            ≈ {formatINR(weiToInr(unitPrice, rate))}
          </div>

          <div className="flex justify-between mt-16 mb-8" style={{fontSize: 13}}>
            <span className="muted">Available in section</span>
            <span>
              {sectionRemaining} / {section?.maxTickets ?? 0}
            </span>
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
              : `Buy ${quantity > 1 ? quantity + " " + section.name + " tickets" : section.name + " ticket"}`}
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
 * Poster banner. Renders the event's image through a rotating list of
 * IPFS gateways when available; falls back to a deterministic gradient
 * placeholder keyed off the event name so the hero still looks intentional.
 */
function EventPoster({ metadataURI, meta, metaLoading, alt, category }) {
  const imageUri = meta?.image;
  const gateways = imageUri ? ipfsGatewayUrls(imageUri) : [];
  const [gwIdx, setGwIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  if (metaLoading && !imageUri && metadataURI) {
    return (
      <div className="card" style={{padding: 0, overflow: "hidden"}}>
        <div className="skel" style={{aspectRatio: "21 / 9", width: "100%"}} />
      </div>
    );
  }

  if (!imageUri || failed || gateways.length === 0) {
    return (
      <div className="card" style={{padding: 0, overflow: "hidden"}}>
        <PosterPlaceholder alt={alt} category={category} />
      </div>
    );
  }

  return (
    <div className="card" style={{padding: 0, overflow: "hidden"}}>
      <img
        src={gateways[gwIdx]}
        alt={alt}
        style={{
          display: "block",
          width: "100%",
          aspectRatio: "21 / 9",
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

function posterGradientFor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (hue1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 55%), hsl(${hue2} 75% 40%))`;
}

function PosterPlaceholder({ alt, category }) {
  return (
    <div
      role="img"
      aria-label={alt}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "21 / 9",
        background: posterGradientFor(alt || "event"),
        color: "rgba(255,255,255,0.95)",
        display: "flex",
        alignItems: "flex-end",
        padding: 28,
      }}
    >
      <div>
        {category && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              opacity: 0.85,
              marginBottom: 8,
            }}
          >
            {category}
          </div>
        )}
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: "2.2rem",
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: "80%",
            textShadow: "0 2px 12px rgba(0,0,0,0.25)",
          }}
        >
          {alt}
        </div>
      </div>
    </div>
  );
}
