import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { useListings } from "../hooks/useEvents";
import { formatDate, formatETH, parseETH } from "../utils/helpers";

/**
 * Resale marketplace. Listings are grouped by event so the same show isn't
 * repeated six times down the page when multiple holders list the same
 * event. Each event card shows a "from X ETH" summary plus the number of
 * tiers represented in the active listings, and can be expanded to buy.
 */
export default function Marketplace({ contract, account, isConnected, connect, toast, refreshKey, bump }) {
  const { listings, loading, refetch } = useListings(contract, refreshKey);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [minPriceEth, setMinPriceEth] = useState("");
  const [maxPriceEth, setMaxPriceEth] = useState("");
  const [expanded, setExpanded] = useState(null); // eventId

  const { minPriceWei, maxPriceWei } = useMemo(() => {
    let min = null, max = null;
    try { if (minPriceEth) min = parseETH(minPriceEth); } catch { /* ignore invalid input */ }
    try { if (maxPriceEth) max = parseETH(maxPriceEth); } catch { /* ignore invalid input */ }
    return { minPriceWei: min, maxPriceWei: max };
  }, [minPriceEth, maxPriceEth]);

  const categories = useMemo(() => {
    const set = new Set();
    listings.forEach((l) => { if (l.event?.category) set.add(l.event.category); });
    return ["All", ...Array.from(set)];
  }, [listings]);

  // Keep listings matching the text / category / price filters.
  const filteredListings = useMemo(() => {
    return listings.filter((l) => {
      if (!l.event) return false;
      if (activeCat !== "All" && l.event.category !== activeCat) return false;
      const price = BigInt(l.listing.price);
      if (minPriceWei !== null && price < minPriceWei) return false;
      if (maxPriceWei !== null && price > maxPriceWei) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const inText =
          l.event.name.toLowerCase().includes(q) ||
          (l.event.category || "").toLowerCase().includes(q) ||
          (l.event.description || "").toLowerCase().includes(q) ||
          (l.section?.name || "").toLowerCase().includes(q);
        if (!inText) return false;
      }
      return true;
    });
  }, [listings, query, activeCat, minPriceWei, maxPriceWei]);

  // Group the filtered listings by event for the summary view.
  const groupedByEvent = useMemo(() => {
    const groups = new Map();
    for (const l of filteredListings) {
      const id = l.eventId;
      if (!groups.has(id)) {
        groups.set(id, {
          eventId: id,
          event: l.event,
          listings: [],
          tiers: new Set(),
          minPrice: null,
          maxPrice: null,
        });
      }
      const g = groups.get(id);
      g.listings.push(l);
      if (l.section?.name) g.tiers.add(l.section.name);
      const p = BigInt(l.listing.price);
      if (g.minPrice === null || p < g.minPrice) g.minPrice = p;
      if (g.maxPrice === null || p > g.maxPrice) g.maxPrice = p;
    }
    return Array.from(groups.values()).sort(
      (a, b) => Number(a.event.date) - Number(b.event.date)
    );
  }, [filteredListings]);

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

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Resale marketplace</p>
        <h1>Tickets from other holders</h1>
        <p className="lead mt-16" style={{maxWidth: 620}}>
          Every ticket can be resold here. Organisers earn a royalty on each
          resale — pricing and seller payout are previewed before you buy.
        </p>
      </section>

      <div className="section-header">
        <div>
          <h2>Active listings</h2>
          <div className="aside">
            {filteredListings.length} listing{filteredListings.length !== 1 ? "s" : ""} ·{" "}
            {groupedByEvent.length} event{groupedByEvent.length !== 1 ? "s" : ""}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""}`}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={handleRefresh}>Refresh</button>
      </div>

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
          <span className="muted" style={{fontSize: 13}}>Price (ETH):</span>
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
      ) : groupedByEvent.length === 0 ? (
        <div className="empty">
          <h3>No listings match your filters</h3>
          <p>
            {activeFilterCount > 0
              ? "Try broadening your search or price range."
              : "Nobody is reselling tickets right now."}
          </p>
          {activeFilterCount > 0 ? (
            <button className="btn btn-primary" onClick={clearFilters}>Reset filters</button>
          ) : (
            <Link to="/events" className="btn btn-primary">Browse events instead</Link>
          )}
        </div>
      ) : (
        <div className="flex-col gap-16">
          {groupedByEvent.map((g) => {
            const isOpen = expanded === g.eventId;
            const priceLabel =
              g.minPrice === g.maxPrice
                ? `${formatETH(g.minPrice)} ETH`
                : `${formatETH(g.minPrice)} – ${formatETH(g.maxPrice)} ETH`;
            return (
              <div key={g.eventId} className="card">
                <div
                  className="flex justify-between items-center"
                  style={{gap: 12, flexWrap: "wrap"}}
                >
                  <div style={{minWidth: 0}}>
                    <div className="flex items-center gap-8" style={{flexWrap: "wrap"}}>
                      <h3 className="card-title" style={{marginBottom: 0}}>
                        {g.event.name}
                      </h3>
                      {g.event.cancelled && <span className="tag red">Cancelled</span>}
                    </div>
                    <div className="muted mt-8" style={{fontSize: 13}}>
                      {g.event.category} · {formatDate(g.event.date)} ·{" "}
                      {g.listings.length} listing{g.listings.length !== 1 ? "s" : ""}
                      {g.tiers.size > 0 && (
                        <> · {Array.from(g.tiers).join(" · ")}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-12" style={{flexWrap: "wrap"}}>
                    <div style={{textAlign: "right"}}>
                      <div className="muted" style={{fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em"}}>
                        {g.listings.length > 1 ? "Price range" : "Asking"}
                      </div>
                      <div style={{fontFamily: "var(--serif)", fontSize: "1.15rem"}}>
                        {priceLabel}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setExpanded(isOpen ? null : g.eventId)}
                    >
                      {isOpen ? "Hide listings" : "View listings"}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div
                    className="event-grid mt-16"
                    style={{borderTop: "1px solid var(--border)", paddingTop: 16}}
                  >
                    {g.listings
                      .slice()
                      .sort(
                        (a, b) =>
                          Number(a.listing.price) - Number(b.listing.price)
                      )
                      .map((l) => (
                        <ListingCard
                          key={l.tokenId}
                          tokenId={l.tokenId}
                          event={l.event}
                          section={l.section}
                          seller={l.listing.seller}
                          price={l.listing.price}
                          expiresAt={l.listing.expiresAt}
                          contract={contract}
                          account={account}
                          toast={toast}
                          onAction={handleRefresh}
                        />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isConnected && (
        <div className="alert info mt-24">
          <span>
            You're browsing in read-only mode.{" "}
            <button
              className="btn btn-sm btn-primary"
              style={{marginLeft: 6}}
              onClick={connect}
            >
              Connect wallet
            </button>{" "}
            to buy listings.
          </span>
        </div>
      )}
    </div>
  );
}
