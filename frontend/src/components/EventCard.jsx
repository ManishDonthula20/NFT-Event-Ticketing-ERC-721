import { useState } from "react";
import { Link } from "react-router-dom";
import {
  formatDate,
  formatETH,
  isPast,
  ticketsRemaining,
  bpsToPercent,
} from "../utils/helpers";
import { ipfsGatewayUrls } from "../utils/ipfs";
import { useIpfsMetadata } from "../hooks/useIpfsMetadata";

export default function EventCard({ event }) {
  const remaining = ticketsRemaining(event.maxTickets, event.ticketsSold);
  const percentSold = event.maxTickets
    ? (event.ticketsSold / event.maxTickets) * 100
    : 0;
  const soldOut = remaining <= 0;
  const expired = isPast(event.date);
  const cancelled = event.cancelled;

  const { data: meta } = useIpfsMetadata(event.metadataURI);

  let state = null;
  if (cancelled) state = { label: "Cancelled", cls: "red" };
  else if (expired) state = { label: "Past", cls: "neutral" };
  else if (soldOut) state = { label: "Sold out", cls: "amber" };

  return (
    <article className="card event-card interactive" style={{padding: 0, overflow: "hidden"}}>
      <CardThumbnail imageUri={meta?.image} alt={event.name} />
      <div style={{padding: 22, display: "flex", flexDirection: "column", gap: 14}}>
      <div className="flex justify-between items-center">
        <span className="tag neutral">{event.category || "Event"}</span>
        {state && <span className={`tag ${state.cls}`}>{state.label}</span>}
      </div>

      <div>
        <h3 className="card-title" style={{marginBottom: 4}}>{event.name}</h3>
        <p className="muted" style={{fontSize: 13}}>
          {formatDate(event.date)}
          {event.royaltyBps > 0 && (
            <> · Royalty {bpsToPercent(event.royaltyBps)}%</>
          )}
        </p>
      </div>

      <div>
        <div className="progress" aria-label="Tickets available">
          <span style={{ width: `${Math.min(100, percentSold)}%` }} />
        </div>
        <div className="flex justify-end mt-8" style={{fontSize: 12, color: "var(--ink-500)"}}>
          <span>{remaining} left</span>
        </div>
      </div>

      <div className="price-row">
        <span className="label">
          {event.sections && event.sections.length > 1 ? "From" : "Ticket price"}
        </span>
        <span className="value">
          {formatETH(event.priceWei)}
          <span className="unit">ETH</span>
        </span>
      </div>

      {event.sections && event.sections.length > 1 && (
        <div className="muted" style={{fontSize: 12, marginTop: -6}}>
          {event.sections.length} sections ·{" "}
          {event.sections.map((s) => s.name).join(" · ")}
        </div>
      )}

      <div className="event-actions">
        <Link
          to={`/event/${event.id}`}
          className="btn btn-primary btn-block"
        >
          {soldOut || expired || cancelled ? "View details" : "Get ticket"}
        </Link>
      </div>
      </div>
    </article>
  );
}

function CardThumbnail({ imageUri, alt }) {
  const gateways = imageUri ? ipfsGatewayUrls(imageUri) : [];
  const [gwIdx, setGwIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  if (!imageUri || failed || gateways.length === 0) return null;

  return (
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
      loading="lazy"
      onError={() => {
        if (gwIdx + 1 < gateways.length) setGwIdx(gwIdx + 1);
        else setFailed(true);
      }}
    />
  );
}
