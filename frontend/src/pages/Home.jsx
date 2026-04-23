import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EventCard from "../components/EventCard";
import { useEvents } from "../hooks/useEvents";
import { isPast } from "../utils/helpers";

export default function Home({ contract, refreshKey }) {
  const { events, loading, error, refetch } = useEvents(contract, refreshKey);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [showPast, setShowPast] = useState(false);

  const categories = useMemo(() => {
    const set = new Set();
    events.forEach((e) => { if (e.category) set.add(e.category); });
    return ["All", ...Array.from(set)];
  }, [events]);

  const filtered = useMemo(() => {
    return events
      .filter((e) => (showPast ? isPast(e.date) : !isPast(e.date)))
      .filter((e) => (activeCat === "All" ? true : e.category === activeCat))
      .filter((e) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          e.name.toLowerCase().includes(q) ||
          (e.category || "").toLowerCase().includes(q)
        );
      });
  }, [events, query, activeCat, showPast]);

  const upcomingCount = events.filter((e) => !isPast(e.date)).length;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">Blockpass</p>
        <h1>Find your next event.</h1>
        <div className="flex gap-12 mt-24" style={{flexWrap: "wrap"}}>
          <Link to="#events" className="btn btn-primary">Browse events</Link>
          <Link to="/create" className="btn btn-ghost">Organise an event</Link>
        </div>
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
            </div>
          </div>
          <div className="flex gap-8">
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
            placeholder="Search events by name or category…"
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

        {error && (
          <div className="alert danger mb-16">
            Failed to load events. Make sure the contract is deployed and you
            are on the correct network.
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
            <h3>No events found</h3>
            <p>
              {showPast
                ? "No past events yet."
                : "No upcoming events match your filters. Be the first to create one."}
            </p>
            {!showPast && (
              <Link to="/create" className="btn btn-primary">Create event</Link>
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
