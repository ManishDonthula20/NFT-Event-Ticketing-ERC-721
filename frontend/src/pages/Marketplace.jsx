import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "../components/ListingCard";
import { useListings } from "../hooks/useEvents";

export default function Marketplace({ contract, account, isConnected, connect, toast, refreshKey, bump }) {
  const { listings, loading, refetch } = useListings(contract, refreshKey);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");

  const categories = useMemo(() => {
    const set = new Set();
    listings.forEach((l) => { if (l.event?.category) set.add(l.event.category); });
    return ["All", ...Array.from(set)];
  }, [listings]);

  const filtered = useMemo(() => {
    return listings.filter((l) => {
      if (!l.event) return false;
      if (activeCat !== "All" && l.event.category !== activeCat) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          l.event.name.toLowerCase().includes(q) ||
          (l.event.category || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [listings, query, activeCat]);

  const handleRefresh = () => { refetch(); bump?.(); };

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Resale marketplace</p>
        <h1>Tickets from other holders</h1>
      </section>

      <div className="section-header">
        <div>
          <h2>Active listings</h2>
          <div className="aside">
            {filtered.length} listing{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={handleRefresh}>Refresh</button>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search listings…"
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
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>No active listings</h3>
          <p>Nobody is reselling tickets right now.</p>
          <Link to="/" className="btn btn-primary">Browse events instead</Link>
        </div>
      ) : (
        <div className="event-grid">
          {filtered.map((l) => (
            <ListingCard
              key={l.tokenId}
              tokenId={l.tokenId}
              event={l.event}
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
