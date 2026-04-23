import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  parseETH,
  formatETH,
  percentToBps,
  bpsToPercent,
  humanizeError,
  isSameAddress,
} from "../utils/helpers";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";

const CATEGORIES = [
  "Music", "Theatre", "Sports", "Conference", "Workshop", "Community", "Other",
];

// Convert a unix timestamp to the value format expected by <input type=datetime-local>.
function unixToLocalInput(unix) {
  if (!unix) return "";
  const d = new Date(Number(unix) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + "T" +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes())
  );
}

export default function EditEvent({ contract, account, isConnected, connect, toast, bump }) {
  const { id } = useParams();
  const eventId = Number(id);
  const navigate = useNavigate();
  const rate = useInrRate();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await contract.getEvent(eventId);
      setEvent(ev);
      if (ev) {
        setForm({
          name: ev.name,
          category: ev.category || "Music",
          metadataURI: ev.metadataURI || "",
          date: unixToLocalInput(ev.date),
          priceEth: formatETH(ev.priceWei, 6),
          royaltyPercent: String(bpsToPercent(ev.royaltyBps)),
          maxPerBuyer: String(ev.maxPerBuyer),
        });
      }
    } catch {
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [contract, eventId]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const priceLocked = useMemo(
    () => (event ? event.ticketsSold > 0 : false),
    [event]
  );

  const inrPerTicket = useMemo(() => {
    if (!form?.priceEth) return 0;
    try {
      const wei = parseETH(form.priceEth);
      return weiToInr(wei, rate);
    } catch {
      return 0;
    }
  }, [form?.priceEth, rate]);

  if (!isConnected) {
    return (
      <div className="empty">
        <h3>Connect your wallet</h3>
        <p>You need to connect the organiser wallet to edit events.</p>
        <button className="btn btn-primary" onClick={connect}>Connect wallet</button>
      </div>
    );
  }

  if (loading || !form) {
    return (
      <div className="card">
        <div className="skel" style={{height: 36, width: "50%", marginBottom: 12}} />
        <div className="skel" style={{height: 14, width: "80%", marginBottom: 6}} />
        <div className="skel" style={{height: 100, width: "100%"}} />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="empty">
        <h3>Event not found</h3>
        <Link to="/organise" className="btn btn-primary">Back to dashboard</Link>
      </div>
    );
  }

  if (!isSameAddress(event.organiser, account)) {
    return (
      <div className="empty">
        <h3>Not authorised</h3>
        <p>Only the event's organiser wallet can edit it.</p>
        <Link to="/organise" className="btn btn-primary">Back to dashboard</Link>
      </div>
    );
  }

  if (event.cancelled) {
    return (
      <div className="empty">
        <h3>Event cancelled</h3>
        <p>Cancelled events cannot be edited.</p>
        <Link to="/organise" className="btn btn-primary">Back to dashboard</Link>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.danger("Name is required.");
    const dateUnix = Math.floor(new Date(form.date).getTime() / 1000);
    if (!dateUnix || dateUnix <= Math.floor(Date.now() / 1000) + 86400)
      return toast.danger("Date must be at least 1 day in the future.");
    const maxPerBuyer = parseInt(form.maxPerBuyer, 10);
    if (!maxPerBuyer || maxPerBuyer < 1)
      return toast.danger("Max per buyer must be ≥ 1.");

    // Price & royalty are locked on-chain once any ticket is sold (see
    // EventTicketNFT.updateEvent — it reverts with
    // "Price/royalty locked after first sale" whenever the submitted
    // values don't match storage bit-for-bit). The form displays them
    // via formatETH(..., 6) + bpsToPercent, which is a lossy float
    // round-trip. Re-using the original BigInt/number from state
    // guarantees the values we submit are byte-identical to storage,
    // so the "if changed" branch in the contract never fires.
    let priceWei;
    let royaltyBps;
    if (priceLocked) {
      priceWei = event.priceWei;
      royaltyBps = event.royaltyBps;
    } else {
      priceWei = parseETH(form.priceEth || "0");
      royaltyBps = percentToBps(parseFloat(form.royaltyPercent) || 0);
      if (royaltyBps > 5000) return toast.danger("Royalty cannot exceed 50%.");
    }

    const payload = {
      name: form.name.trim(),
      category: form.category,
      metadataURI: form.metadataURI.trim(),
      date: dateUnix,
      priceWei,
      royaltyBps,
      maxPerBuyer,
    };

    // Diagnostic trace: when public RPCs strip revert reasons we want to be
    // able to eyeball every submitted vs on-chain value in the console.
    // Printed one per line so a single screenshot captures everything.
    /* eslint-disable no-console */
    console.log("========== [updateEvent] DEBUG ==========");
    console.log("eventId:            ", eventId);
    console.log("connectedAccount:   ", account);
    console.log("on-chain organiser: ", event.organiser);
    console.log("organiser matches?  ", isSameAddress(event.organiser, account));
    console.log("on-chain cancelled: ", event.cancelled);
    console.log("on-chain ticketsSold:", event.ticketsSold);
    console.log("priceLocked:        ", priceLocked);
    console.log("-- submitted --");
    console.log("  name:         ", JSON.stringify(payload.name));
    console.log("  category:     ", JSON.stringify(payload.category));
    console.log("  metadataURI:  ", JSON.stringify(payload.metadataURI));
    console.log("  date (unix):  ", payload.date, "=", new Date(payload.date * 1000).toISOString());
    console.log("  priceWei:     ", payload.priceWei?.toString?.() ?? payload.priceWei);
    console.log("  royaltyBps:   ", payload.royaltyBps);
    console.log("  maxPerBuyer:  ", payload.maxPerBuyer);
    console.log("-- on-chain --");
    console.log("  name:         ", JSON.stringify(event.name));
    console.log("  category:     ", JSON.stringify(event.category));
    console.log("  metadataURI:  ", JSON.stringify(event.metadataURI));
    console.log("  date (unix):  ", event.date, "=", new Date(event.date * 1000).toISOString());
    console.log("  priceWei:     ", event.priceWei?.toString?.());
    console.log("  royaltyBps:   ", event.royaltyBps);
    console.log("  maxPerBuyer:  ", event.maxPerBuyer);
    console.log("  maxTickets:   ", event.maxTickets);
    console.log("-- time sanity --");
    console.log("  now (unix):      ", Math.floor(Date.now() / 1000));
    console.log("  submitted > now+1d?", payload.date > Math.floor(Date.now() / 1000) + 86400);
    console.log("=========================================");
    /* eslint-enable no-console */

    try {
      setBusy(true);
      toast.pending("Updating event…");
      await contract.updateEvent(eventId, payload);
      toast.success("Event updated.");
      bump?.();
      navigate("/organise");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[updateEvent] failed", err);
      toast.danger(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{maxWidth: 820, margin: "0 auto"}}>
      <Link to="/organise" className="muted" style={{fontSize: 13}}>← Back to dashboard</Link>

      <section className="hero" style={{marginTop: 8, marginBottom: 24}}>
        <p className="eyebrow">Organiser · Edit event</p>
        <h1>Edit {event.name}</h1>
      </section>

      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field row2">
            <label>Event name *</label>
            <input type="text" value={form.name} onChange={set("name")} required />
          </div>

          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => (<option key={c}>{c}</option>))}
            </select>
          </div>

          <div className="field">
            <label>Date & time *</label>
            <input type="datetime-local" value={form.date} onChange={set("date")} required />
          </div>

          <div className="field row2">
            <label>Metadata URI</label>
            <input
              type="text"
              value={form.metadataURI}
              onChange={set("metadataURI")}
              placeholder="ipfs://bafybei…"
            />
          </div>

          <div className="field">
            <label>Ticket price (ETH) {priceLocked && <span className="muted">· locked</span>}</label>
            <input
              type="number" min="0" step="0.0001"
              value={form.priceEth}
              onChange={set("priceEth")}
              disabled={priceLocked}
            />
            {!priceLocked && inrPerTicket > 0 && (
              <div className="hint">≈ {formatINR(inrPerTicket)}</div>
            )}
            {priceLocked && (
              <div className="hint">Price cannot change after the first ticket is sold.</div>
            )}
          </div>

          <div className="field">
            <label>Royalty (%) {priceLocked && <span className="muted">· locked</span>}</label>
            <input
              type="number" min="0" max="50" step="0.1"
              value={form.royaltyPercent}
              onChange={set("royaltyPercent")}
              disabled={priceLocked}
            />
            {priceLocked && (
              <div className="hint">Royalty cannot change after the first ticket is sold.</div>
            )}
          </div>

          <div className="field">
            <label>Max tickets per buyer</label>
            <input
              type="number" min="1" max="10" step="1"
              value={form.maxPerBuyer}
              onChange={set("maxPerBuyer")}
            />
            <div className="hint">Global cap is 10.</div>
          </div>

          <div className="field row2">
            <label>Supply</label>
            <div className="muted" style={{fontSize: 13}}>
              {event.ticketsSold} sold out of {event.maxTickets} minted.
              Use the <Link to="/organise">dashboard</Link> "Add tickets" button to mint more.
            </div>
          </div>
        </div>

        <hr className="rule" />

        <div className="flex justify-between items-center">
          <span className="muted" style={{fontSize: 13}}>
            Only the fields you change will be submitted on-chain.
          </span>
          <div className="flex gap-8">
            <Link to="/organise" className="btn btn-ghost">Discard</Link>
            <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
              {busy ? "Updating…" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
