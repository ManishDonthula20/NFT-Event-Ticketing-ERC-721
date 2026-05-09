import { Link } from "react-router-dom";
import { useEvents } from "../hooks/useEvents";
import { isPast } from "../utils/helpers";

/**
 *  BookYourShow landing page — the first impression for visitors.
 *
 *  Gives the app its voice before we drop users into the catalog:
 *  - What the app is
 *  - What makes it different (on-chain tickets, tier pricing, royalties, resale)
 *  - Where to go next (events, marketplace, organise)
 */
export default function Landing({ contract, refreshKey }) {
  const { events } = useEvents(contract, refreshKey);
  const upcoming = events.filter((e) => !isPast(e.date) && !e.cancelled).length;

  const features = [
    {
      title: "Tier-based seating",
      body:
        "Events can be split into multiple sections - VIP, Regular, Economy - each with its own price and supply. Buyers pick the tier they want.",
    },
    {
      title: "Resale with royalties",
      body:
        "Every ticket is an NFT. Holders can resell on the in-app marketplace, and organisers automatically earn a royalty on every resale.",
    },
    {
      title: "Anti-scalping by default",
      body:
        "Purchase caps per wallet, address-level accounting, and check-in invalidation at the venue keep the experience fair for real attendees.",
    },
    {
      title: "On-chain descriptions",
      body:
        "Event names and descriptions live on the blockchain, not a backend. Images and extra metadata are pinned on IPFS directly from the app.",
    },
  ];

  const flow = [
    {
      step: "01",
      title: "Browse events",
      body:
        "Search by name, filter by category and price range, and preview tier availability before you buy.",
    },
    {
      step: "02",
      title: "Pick your tier",
      body:
        "Choose the section that fits your budget. See live remaining supply and the exact ETH price per ticket.",
    },
    {
      step: "03",
      title: "Your tickets travel with you",
      body:
        "Tickets are NFTs in your wallet. Keep them, gift them, or list them on the resale market — the choice is yours.",
    },
  ];

  return (
    <div>
      <section className="hero" style={{paddingTop: 40, paddingBottom: 32}}>
        <p className="eyebrow">BookYourShow</p>
        <h1 style={{fontSize: "clamp(2.2rem, 5vw, 3.4rem)", lineHeight: 1.1}}>
          Tickets for the shows you love — owned by you, on the blockchain.
        </h1>
        <p className="lead mt-16" style={{maxWidth: 680}}>
          BookYourShow is a decentralised ticketing platform where every
          ticket is an NFT. Organisers create events with multiple seating
          tiers, and buyers book, keep, or resell them — with organisers
          earning a royalty on every resale.
        </p>
        <div className="flex gap-12 mt-24" style={{flexWrap: "wrap"}}>
          <Link to="/events" className="btn btn-primary btn-lg">
            Browse events
            {upcoming > 0 && <span className="tag neutral" style={{marginLeft: 10}}>{upcoming} live</span>}
          </Link>
          <Link to="/marketplace" className="btn btn-ghost btn-lg">
            Resale marketplace
          </Link>
          <Link to="/create" className="btn btn-ghost btn-lg">
            Host an event
          </Link>
        </div>
      </section>

      <section className="mb-32">
        <div className="section-header">
          <div>
            <h2>Why BookYourShow?</h2>
            <div className="aside">Built around fair pricing and ownership.</div>
          </div>
        </div>
        <div
          className="event-grid"
          style={{gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))"}}
        >
          {features.map((f) => (
            <div key={f.title} className="card">
              <h3 className="card-title" style={{fontSize: "1.1rem"}}>{f.title}</h3>
              <p className="muted mt-8" style={{lineHeight: 1.6}}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-32">
        <div className="section-header">
          <div>
            <h2>How it works</h2>
            <div className="aside">From browsing to check-in.</div>
          </div>
        </div>
        <div
          className="event-grid"
          style={{gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"}}
        >
          {flow.map((s) => (
            <div key={s.step} className="card">
              <div className="muted" style={{fontFamily: "var(--serif)", fontSize: "1.6rem"}}>
                {s.step}
              </div>
              <h3 className="card-title" style={{fontSize: "1.1rem", marginTop: 6}}>
                {s.title}
              </h3>
              <p className="muted mt-8" style={{lineHeight: 1.6}}>
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{
        background: "linear-gradient(135deg, var(--surface-alt), var(--surface))",
        textAlign: "center",
        padding: 36,
      }}>
        <h2 style={{fontSize: "1.7rem", marginBottom: 10}}>Ready to find your next show?</h2>
        <p className="muted" style={{maxWidth: 520, margin: "0 auto 20px"}}>
          Browse live events, pick your tier, and keep your ticket forever.
        </p>
        <div className="flex gap-12" style={{justifyContent: "center", flexWrap: "wrap"}}>
          <Link to="/events" className="btn btn-primary btn-lg">Explore events</Link>
          <Link to="/my-tickets" className="btn btn-ghost btn-lg">My tickets</Link>
        </div>
      </section>
    </div>
  );
}
