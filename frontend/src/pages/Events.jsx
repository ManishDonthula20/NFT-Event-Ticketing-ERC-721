import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EventCard from "../components/EventCard";
import { useEvents } from "../hooks/useEvents";
import { isPast, parseETH } from "../utils/helpers";

/**
 * Catalogue of on-chain events with search, category, and price-range
 * filters. The price range filter works on the event-level aggregate
 * `priceWei` (the cheapest section) — i.e. "show me events I could get
 * into for less than N ETH".
 */
export default function Events({ contract, refreshKey }) {
  const { events, loading, error, refetch } = useEvents(contract, refreshKey);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [showPast, setShowPast] = useState(false);
  const [minPriceEth, setMinPriceEth] = useState("");
  const [maxPriceEth, setMaxPriceEth] = useState("");

  const categories = useMemo(() => {
    const set = new Set();
    events.forEach((e) => { if (e.category) set.add(e.category); });
    return ["All", ...Array.from(set)];
  }, [events]);

  // Parse the price range once per keystroke — invalid input silently
  // collapses back to "no filter" so the UI never shows a blank page
  // just because the user typed something weird.
  const { minPriceWei, maxPriceWei } = useMemo(() => {
    let min = null, max = null;
    try { if (minPriceEth) min = parseETH(minPriceEth); } catch { /* ignore invalid input */ }
    try { if (maxPriceEth) max = parseETH(maxPriceEth); } catch { /* ignore invalid input */ }
    return { minPriceWei: min, maxPriceWei: max };
  }, [minPriceEth, maxPriceEth]);

  // Event-level priceWei is the *cheapest* section. For a range filter
  // we consider an event "matches" if ANY of its sections falls in the
  // [min, max] window, so "<= 0.1 ETH" still surfaces events whose
  // cheapest tier is 0.05 and whose VIP tier is 0.5.
  const eventMatchesPrice = (e) => {
    if (minPriceWei === null && maxPriceWei === null) return true;
    const prices = (e.sections || []).map((s) => BigInt(s.priceWei));
    if (!prices.length) return true;
    return prices.some((p) => {
      if (minPriceWei !== null && p < minPriceWei) return false;
      if (maxPriceWei !== null && p > maxPriceWei) return false;
      return true;
    });
  };

  const filtered = useMemo(() => {
    return events
      .filter((e) => (showPast ? isPast(e.date) : !isPast(e.date)))
      .filter((e) => (activeCat === "All" ? true : e.category === activeCat))
      .filter(eventMatchesPrice)
      .filter((e) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          (e.category || "").toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q)
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, query, activeCat, showPast, minPriceWei, maxPriceWei]);

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

  const upcomingCount = events.filter((e) => !isPast(e.date)).length;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Events</p>
        <h1>Find your next show.</h1>
        <p className="lead mt-16" style={{maxWidth: 620}}>
          Search and filter across every live event on BookYourShow. Every
          ticket is an NFT minted to your wallet.
        </p>
      </section>

      <section className="stats mb-32">
        <div className="stat">
          <div className="num">{upcomingCount}</div>
          <div className="lbl">Upcoming events</div>
        </div>
        <div className="stat">
          <div className="num">{events.length}</div>
          <div className="lbl">Total events</div>
        </div>
      </section>

      <section id="events">
        <div className="section-header">
          <div>
            <h2>{showPast ? "Past events" : "Upcoming events"}</h2>
            <div className="aside">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""}`}
            </div>
          </div>
          <div className="flex gap-8" style={{flexWrap: "wrap"}}>
            <button
              className={`btn btn-sm ${showPast ? "btn-ghost" : "btn-primary"}`}
              onClick={() => setShowPast(false)}
            >
              Upcoming
            </button>
            <button
              className={`btn btn-sm ${showPast ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setShowPast(true)}
            >
              Past
            </button>
            <button className="btn btn-sm btn-ghost" onClick={refetch}>Refresh</button>
          </div>
        </div>

        <div className="filter-bar">
          <input
            type="text"
            placeholder="Search by name, category, or description…"
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

        {error && (
          <div className="alert danger mb-16">
            Couldn't load events. Make sure the app is pointed at the right
            network and the contract is deployed.
          </div>
        )}

        {loading ? (
          <div className="event-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card" style={{ height: 260 }}>
                <div className="skel" style={{ height: 14, width: "40%", marginBottom: 12 }} />
                <div className="skel" style={{ height: 24, width: "80%", marginBottom: 12 }} />
                <div className="skel" style={{ height: 12, width: "60%", marginBottom: 24 }} />
                <div className="skel" style={{ height: 4, width: "100%", marginBottom: 14 }} />
                <div className="skel" style={{ height: 40, width: "100%" }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <h3>No events match your filters</h3>
            <p>
              {showPast
                ? "No past events yet."
                : activeFilterCount > 0
                ? "Try broadening your search or price range."
                : "No upcoming events yet. Be the first to create one."}
            </p>
            {activeFilterCount > 0 ? (
              <button className="btn btn-primary" onClick={clearFilters}>Reset filters</button>
            ) : !showPast && (
              <Link to="/create" className="btn btn-primary">Host an event</Link>
            )}
          </div>
        ) : (
          <div className="event-grid">
            {filtered.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
