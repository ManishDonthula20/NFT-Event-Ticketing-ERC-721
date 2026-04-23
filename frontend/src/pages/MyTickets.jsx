import { useMemo } from "react";
import { Link } from "react-router-dom";
import TicketCard from "../components/TicketCard";
import { useUserTickets } from "../hooks/useEvents";
import { isPast } from "../utils/helpers";

export default function MyTickets({ contract, account, isConnected, connect, toast, refreshKey, bump }) {
  const { tickets, loading, refetch } = useUserTickets(contract, account, refreshKey);

  // We split tickets into:
  //   - listed:        currently on the resale marketplace
  //   - upcomingOwned: future events, NOT listed (you can still use / resell)
  //   - past:          event already happened
  // A listed ticket is still owned by the user on-chain, so we deliberately
  // render it once (in the "Listed" group) rather than duplicating it.
  const { listed, upcomingOwned, past } = useMemo(() => {
    const listed = [];
    const upcomingOwned = [];
    const past = [];
    for (const t of tickets) {
      if (!t.event) continue;
      const future = !isPast(t.event.date);
      if (t.listing?.active) {
        listed.push(t);
      } else if (future) {
        upcomingOwned.push(t);
      } else {
        past.push(t);
      }
    }
    // Newest tokenId first in every bucket so the most recent purchase
    // is what the user sees without scrolling.
    const byNewest = (a, b) => Number(b.tokenId) - Number(a.tokenId);
    listed.sort(byNewest);
    upcomingOwned.sort(byNewest);
    past.sort(byNewest);
    return { listed, upcomingOwned, past };
  }, [tickets]);

  const uniqueEventCount = useMemo(
    () => new Set(tickets.map((t) => t.eventId)).size,
    [tickets]
  );

  const handleRefresh = () => { refetch(); bump?.(); };

  if (!isConnected) {
    return (
      <div className="empty">
        <h3>Connect your wallet</h3>
        <p>Your NFT tickets are tied to your wallet address.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
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

  return (
    <div>
      <div className="section-header">
        <div>
          <h2>My tickets</h2>
          <div className="aside">
            {tickets.length} ticket{tickets.length !== 1 ? "s" : ""} across {uniqueEventCount} event{uniqueEventCount !== 1 ? "s" : ""}
            {listed.length > 0 && ` · ${listed.length} listed on resale`}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={handleRefresh}>Refresh</button>
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
      ) : tickets.length === 0 ? (
        <div className="empty">
          <h3>No tickets yet</h3>
          <p>Browse upcoming events and buy your first ticket.</p>
          <Link to="/" className="btn btn-primary">Browse events</Link>
        </div>
      ) : (
        <>
          {listed.length > 0 && (
            <section className="mb-32">
              <h3 className="mb-16" style={sectionTitleStyle}>
                Listed for resale · {listed.length}
              </h3>
              <div className="event-grid">
                {listed.map((t) => (
                  <TicketCard
                    key={t.tokenId}
                    ticket={t}
                    contract={contract}
                    toast={toast}
                    onAction={handleRefresh}
                  />
                ))}
              </div>
            </section>
          )}
          {upcomingOwned.length > 0 && (
            <section className="mb-32">
              <h3 className="mb-16" style={sectionTitleStyle}>
                Upcoming · {upcomingOwned.length}
              </h3>
              <div className="event-grid">
                {upcomingOwned.map((t) => (
                  <TicketCard
                    key={t.tokenId}
                    ticket={t}
                    contract={contract}
                    toast={toast}
                    onAction={handleRefresh}
                  />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h3 className="mb-16" style={sectionTitleStyle}>
                Past · {past.length}
              </h3>
              <div className="event-grid">
                {past.map((t) => (
                  <TicketCard
                    key={t.tokenId}
                    ticket={t}
                    contract={contract}
                    toast={toast}
                    onAction={handleRefresh}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
