import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import TicketCard from "../components/TicketCard";
import { useUserTickets } from "../hooks/useEvents";
import { formatDate, formatETH, isPast, parseETH } from "../utils/helpers";

export default function MyTickets({ contract, account, isConnected, connect, toast, refreshKey, bump }) {
  const { tickets, loading, refetch } = useUserTickets(contract, account, refreshKey);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [minPriceEth, setMinPriceEth] = useState("");
  const [maxPriceEth, setMaxPriceEth] = useState("");
  const [expandedGroup, setExpandedGroup] = useState(null); // `${bucket}:${eventId}`

  const { minPriceWei, maxPriceWei } = useMemo(() => {
    let min = null, max = null;
    try { if (minPriceEth) min = parseETH(minPriceEth); } catch { /* ignore invalid input */ }
    try { if (maxPriceEth) max = parseETH(maxPriceEth); } catch { /* ignore invalid input */ }
    return { minPriceWei: min, maxPriceWei: max };
  }, [minPriceEth, maxPriceEth]);

  // `ticketPrice` is what the user actually paid — the section price at
  // mint time. Falls back to event-level aggregate if section data is
  // missing for legacy reads.
  const ticketPrice = (t) =>
    BigInt(t.section?.priceWei ?? t.event?.priceWei ?? 0);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (!t.event) return false;
      if (activeCat !== "All" && t.event.category !== activeCat) return false;
      const p = ticketPrice(t);
      if (minPriceWei !== null && p < minPriceWei) return false;
      if (maxPriceWei !== null && p > maxPriceWei) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const inText =
          t.event.name.toLowerCase().includes(q) ||
          (t.event.category || "").toLowerCase().includes(q) ||
          (t.event.description || "").toLowerCase().includes(q) ||
          (t.section?.name || "").toLowerCase().includes(q);
        if (!inText) return false;
      }
      return true;
    });
  }, [tickets, query, activeCat, minPriceWei, maxPriceWei]);

  const categories = useMemo(() => {
    const set = new Set();
    tickets.forEach((t) => { if (t.event?.category) set.add(t.event.category); });
    return ["All", ...Array.from(set)];
  }, [tickets]);

  // Split into buckets then group-by-event inside each bucket.
  const bucketed = useMemo(() => {
    const buckets = { listed: [], upcoming: [], past: [] };
    for (const t of filteredTickets) {
      if (!t.event) continue;
      const future = !isPast(t.event.date);
      if (t.listing?.active) buckets.listed.push(t);
      else if (future) buckets.upcoming.push(t);
      else buckets.past.push(t);
    }
    const groupByEvent = (arr) => {
      const groups = new Map();
      for (const t of arr) {
        if (!groups.has(t.eventId)) {
          groups.set(t.eventId, {
            eventId: t.eventId,
            event: t.event,
            tickets: [],
            tiers: new Map(), // tierName -> count
            minPrice: null,
            maxPrice: null,
          });
        }
        const g = groups.get(t.eventId);
        g.tickets.push(t);
        if (t.section?.name) {
          g.tiers.set(t.section.name, (g.tiers.get(t.section.name) || 0) + 1);
        }
        const p = ticketPrice(t);
        if (g.minPrice === null || p < g.minPrice) g.minPrice = p;
        if (g.maxPrice === null || p > g.maxPrice) g.maxPrice = p;
      }
      return Array.from(groups.values()).sort(
        (a, b) => Number(b.event.date) - Number(a.event.date)
      );
    };
    return {
      listed:   groupByEvent(buckets.listed),
      upcoming: groupByEvent(buckets.upcoming),
      past:     groupByEvent(buckets.past),
    };
  }, [filteredTickets]);

  const handleRefresh = () => { refetch(); bump?.(); };

  const clearFilters = () => {
    setQuery("");
    setActiveCat("All");
    setMinPriceEth("");
    setMaxPriceEth("");
  };
  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    (activeCat !== "All" ? 1 : 0) +
    (minPriceEth ? 1 : 0) +
    (maxPriceEth ? 1 : 0);

  const uniqueEventCount = useMemo(
    () => new Set(tickets.map((t) => t.eventId)).size,
    [tickets]
  );

  if (!isConnected) {
    return (
      <div className="empty">
        <h3>Connect your wallet</h3>
        <p>Your tickets travel with you — connect to see what you own.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">
        <div>
          <h2>My tickets</h2>
          <div className="aside">
            {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} across{" "}
            {uniqueEventCount} event{uniqueEventCount !== 1 ? "s" : ""}
            {bucketed.listed.length > 0 &&
              ` · ${bucketed.listed.reduce((n, g) => n + g.tickets.length, 0)} listed`}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={handleRefresh}>Refresh</button>
      </div>

      {tickets.length > 0 && (
        <div className="filter-bar">
          <input
            type="text"
            placeholder="Search by event, description, or tier…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chip-row">
            {categories.map((c) => (
              <button
                key={c}
                className={`chip ${activeCat === c ? "active" : ""}`}
                onClick={() => setActiveCat(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div
            className="flex items-center gap-8"
            style={{flexWrap: "wrap", width: "100%"}}
          >
            <span className="muted" style={{fontSize: 13}}>Paid price (ETH):</span>
            <input
              type="number" min="0" step="0.001"
              placeholder="min"
              value={minPriceEth}
              onChange={(e) => setMinPriceEth(e.target.value)}
              style={{maxWidth: 120}}
            />
            <span className="muted">–</span>
            <input
              type="number" min="0" step="0.001"
              placeholder="max"
              value={maxPriceEth}
              onChange={(e) => setMaxPriceEth(e.target.value)}
              style={{maxWidth: 120}}
            />
            {activeFilterCount > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={clearFilters}
                style={{marginLeft: "auto"}}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="event-grid">
          {Array.from({length: 3}).map((_, i) => (
            <div key={i} className="card" style={{height: 240}}>
              <div className="skel" style={{height: 20, width: "40%", marginBottom: 12}} />
              <div className="skel" style={{height: 24, width: "80%", marginBottom: 12}} />
              <div className="skel" style={{height: 12, width: "60%", marginBottom: 24}} />
              <div className="skel" style={{height: 40, width: "100%"}} />
            </div>
          ))}
        </div>
      ) : tickets.length === 0 ? (
        <div className="empty">
          <h3>No tickets yet</h3>
          <p>Browse upcoming events and book your first one.</p>
          <Link to="/events" className="btn btn-primary">Browse events</Link>
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="empty">
          <h3>No tickets match your filters</h3>
          <p>Try broadening your search or price range.</p>
          <button className="btn btn-primary" onClick={clearFilters}>Reset filters</button>
        </div>
      ) : (
        <>
          <EventGroupSection
            bucket="listed"
            title="Listed for resale"
            accent="green"
            groups={bucketed.listed}
            expandedGroup={expandedGroup}
            setExpandedGroup={setExpandedGroup}
            contract={contract}
            toast={toast}
            onAction={handleRefresh}
          />
          <EventGroupSection
            bucket="upcoming"
            title="Upcoming"
            accent="neutral"
            groups={bucketed.upcoming}
            expandedGroup={expandedGroup}
            setExpandedGroup={setExpandedGroup}
            contract={contract}
            toast={toast}
            onAction={handleRefresh}
          />
          <EventGroupSection
            bucket="past"
            title="Past"
            accent="neutral"
            muted
            groups={bucketed.past}
            expandedGroup={expandedGroup}
            setExpandedGroup={setExpandedGroup}
            contract={contract}
            toast={toast}
            onAction={handleRefresh}
          />
        </>
      )}
    </div>
  );
}

const sectionTitleStyle = {
  fontSize: "1.05rem",
  fontFamily: "var(--sans)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--ink-500)",
};

function EventGroupSection({
  bucket, title, groups, expandedGroup, setExpandedGroup,
  contract, toast, onAction, muted,
}) {
  if (groups.length === 0) return null;
  const totalTickets = groups.reduce((n, g) => n + g.tickets.length, 0);
  return (
    <section className="mb-32" style={muted ? {opacity: 0.8} : undefined}>
      <h3 className="mb-16" style={sectionTitleStyle}>
        {title} · {totalTickets} ticket{totalTickets !== 1 ? "s" : ""}
      </h3>
      <div className="flex-col gap-16">
        {groups.map((g) => {
          const key = `${bucket}:${g.eventId}`;
          const isOpen = expandedGroup === key;
          const priceLabel =
            g.minPrice === g.maxPrice
              ? `${formatETH(g.minPrice)} ETH`
              : `${formatETH(g.minPrice)} – ${formatETH(g.maxPrice)} ETH`;
          const tierList = Array.from(g.tiers.entries());
          return (
            <div key={key} className="card">
              <div
                className="flex justify-between items-center"
                style={{gap: 12, flexWrap: "wrap"}}
              >
                <div style={{minWidth: 0}}>
                  <div className="flex items-center gap-8" style={{flexWrap: "wrap"}}>
                    <h4 className="card-title" style={{marginBottom: 0, fontSize: "1.15rem"}}>
                      {g.event.name}
                    </h4>
                    {g.event.cancelled && <span className="tag red">Cancelled</span>}
                  </div>
                  <div className="muted mt-8" style={{fontSize: 13}}>
                    {g.event.category} · {formatDate(g.event.date)} ·{" "}
                    {g.tickets.length} ticket{g.tickets.length !== 1 ? "s" : ""}
                  </div>
                  {tierList.length > 0 && (
                    <div className="flex gap-8 mt-8" style={{flexWrap: "wrap"}}>
                      {tierList.map(([name, count]) => (
                        <span key={name} className="tag neutral">
                          {name} × {count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-12" style={{flexWrap: "wrap"}}>
                  <div style={{textAlign: "right"}}>
                    <div className="muted" style={{fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em"}}>
                      {tierList.length > 1 ? "Paid range" : "Paid"}
                    </div>
                    <div style={{fontFamily: "var(--serif)", fontSize: "1.1rem"}}>
                      {priceLabel}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setExpandedGroup(isOpen ? null : key)}
                  >
                    {isOpen ? "Hide tickets" : "Manage tickets"}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div
                  className="event-grid mt-16"
                  style={{borderTop: "1px solid var(--border)", paddingTop: 16}}
                >
                  {g.tickets.map((t) => (
                    <TicketCard
                      key={t.tokenId}
                      ticket={t}
                      contract={contract}
                      toast={toast}
                      onAction={onAction}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
