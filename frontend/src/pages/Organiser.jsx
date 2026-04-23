import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useEvents } from "../hooks/useEvents";
import {
  formatDate,
  formatETH,
  humanizeError,
  isPast,
  isSameAddress,
  bpsToPercent,
} from "../utils/helpers";

export default function Organiser({ contract, account, isConnected, connect, toast, refreshKey, bump }) {
  const { events, loading, refetch } = useEvents(contract, refreshKey);
  const [addingTo, setAddingTo] = useState(null);
  const [addAmount, setAddAmount] = useState("");
  const [invalidating, setInvalidating] = useState(false);
  const [tokenIdInput, setTokenIdInput] = useState("");
  const [busy, setBusy] = useState(false);

  const myEvents = useMemo(
    () => events.filter((e) => isSameAddress(e.organiser, account)),
    [events, account]
  );

  const refresh = () => { refetch(); bump?.(); };

  const handleAddTickets = async (eventId) => {
    const n = parseInt(addAmount, 10);
    if (!n || n < 1) return toast.danger("Enter a positive integer.");
    try {
      setBusy(true);
      toast.pending(`Adding ${n} tickets…`);
      await contract.addTickets(eventId, n);
      toast.success(`${n} tickets added.`);
      setAddingTo(null);
      setAddAmount("");
      refresh();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelEvent = async (eventId) => {
    if (!window.confirm("Cancel this event? Tickets can no longer be sold or resold.")) return;
    try {
      setBusy(true);
      toast.pending("Cancelling event…");
      await contract.cancelEvent(eventId);
      toast.success("Event cancelled.");
      refresh();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleInvalidate = async () => {
    const id = parseInt(tokenIdInput, 10);
    if (!Number.isInteger(id) || id < 1) return toast.danger("Enter a valid token id.");
    try {
      setBusy(true);
      toast.pending(`Checking in ticket #${id}…`);
      await contract.invalidateTicket(id);
      toast.success(`Ticket #${id} checked in.`);
      setTokenIdInput("");
      setInvalidating(false);
      refresh();
    } catch (e) {
      toast.danger(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="empty">
        <h3>Connect as organiser</h3>
        <p>Connect the wallet you used to create events.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
      </div>
    );
  }

  return (
    <div>
      <section className="hero">
        <p className="eyebrow">Organiser dashboard</p>
        <h1>Manage your events</h1>
      </section>

      <div className="section-header">
        <div>
          <h2>Check-in tool</h2>
          <div className="aside">
            Marks a ticket as checked in at the venue gate.
          </div>
        </div>
        {!invalidating ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setInvalidating(true)}>
            Check in ticket
          </button>
        ) : (
          <div className="flex gap-8 items-center">
            <input
              className="field"
              style={{padding: "8px 12px", border: "1px solid var(--border-strong)", borderRadius: 6, fontSize: 13, width: 140}}
              type="number"
              placeholder="token id"
              value={tokenIdInput}
              onChange={(e) => setTokenIdInput(e.target.value)}
            />
            <button className="btn btn-danger btn-sm" onClick={handleInvalidate} disabled={busy}>
              Confirm
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setInvalidating(false); setTokenIdInput(""); }}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="section-header mt-32">
        <div>
          <h2>My events</h2>
          <div className="aside">
            {myEvents.length} event{myEvents.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={refresh}>Refresh</button>
      </div>

      {loading ? (
        <div className="card"><div className="skel" style={{height: 100}} /></div>
      ) : myEvents.length === 0 ? (
        <div className="empty">
          <h3>You haven't created any events yet</h3>
          <p>Head to the Create tab to launch your first event.</p>
          <Link to="/create" className="btn btn-primary">Create event</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Event</th>
                <th>Date</th>
                <th className="right">Price</th>
                <th className="right">Sold</th>
                <th className="right">Royalty</th>
                <th>Status</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {myEvents.map((e) => {
                const expired = isPast(e.date);
                return (
                  <tr key={e.id}>
                    <td className="mono muted">{e.id}</td>
                    <td>
                      <Link to={`/event/${e.id}`}><b>{e.name}</b></Link>
                      <div className="muted" style={{fontSize: 12}}>{e.category}</div>
                    </td>
                    <td>{formatDate(e.date)}</td>
                    <td className="right mono">{formatETH(e.priceWei)} ETH</td>
                    <td className="right mono">{e.ticketsSold} / {e.maxTickets}</td>
                    <td className="right mono">{bpsToPercent(e.royaltyBps)}%</td>
                    <td>
                      {e.cancelled
                        ? <span className="tag red">Cancelled</span>
                        : expired
                        ? <span className="tag neutral">Past</span>
                        : <span className="tag green">Live</span>}
                    </td>
                    <td className="right">
                      <div className="flex gap-8" style={{justifyContent: "flex-end", flexWrap: "wrap"}}>
                        {addingTo === e.id ? (
                          <>
                            <input
                              type="number"
                              min="1"
                              style={{padding: "6px 10px", border: "1px solid var(--border-strong)", borderRadius: 4, fontSize: 12, width: 70}}
                              value={addAmount}
                              onChange={(ev) => setAddAmount(ev.target.value)}
                              placeholder="count"
                            />
                            <button className="btn btn-sm btn-accent" onClick={() => handleAddTickets(e.id)} disabled={busy}>OK</button>
                            <button className="btn btn-sm btn-ghost" onClick={() => { setAddingTo(null); setAddAmount(""); }}>✕</button>
                          </>
                        ) : (
                          <>
                            <Link
                              to={`/organise/edit/${e.id}`}
                              className="btn btn-sm btn-ghost"
                              style={e.cancelled || expired ? {pointerEvents: "none", opacity: 0.5} : undefined}
                            >
                              Edit
                            </Link>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setAddingTo(e.id)}
                              disabled={e.cancelled || expired}
                            >
                              Add tickets
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleCancelEvent(e.id)}
                              disabled={e.cancelled || expired || busy}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
