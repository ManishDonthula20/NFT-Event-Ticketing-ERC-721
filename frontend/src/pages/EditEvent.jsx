import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  formatETH,
  percentToBps,
  bpsToPercent,
  humanizeError,
  isSameAddress,
} from "../utils/helpers";
import { uploadJSON, toIpfsUri } from "../utils/ipfsUpload";
import { getMetadata } from "../hooks/useIpfsMetadata";

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

  const [event, setEvent] = useState(null);
  const [meta, setMeta] = useState(null); // previously-pinned metadata JSON
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ev = await contract.getEvent(eventId);
      if (!ev) {
        setEvent(null);
        return;
      }
      // The current on-chain record only has the metadataURI. Pull the JSON
      // so we can prefill the form with the last-pinned name/description/etc.
      const existingMeta = await getMetadata(ev.metadataURI).catch(() => null);
      setEvent(ev);
      setMeta(existingMeta);
      setForm({
        name: existingMeta?.name || `Event #${ev.id}`,
        category: existingMeta?.category || "Music",
        description: existingMeta?.description || "",
        date: unixToLocalInput(ev.date),
        royaltyPercent: String(bpsToPercent(ev.royaltyBps)),
        maxPerBuyer: String(ev.maxPerBuyer),
      });
    } catch {
      setEvent(null);
    } finally {
      setLoading(false);
    }
  }, [contract, eventId]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const royaltyLocked = useMemo(
    () => (event ? event.ticketsSold > 0 : false),
    [event]
  );

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

    // Royalty is locked on-chain once any ticket is sold. Re-submit the
    // original BigInt so the contracts "if changed" branch never fires.
    let royaltyBps;
    if (royaltyLocked) {
      royaltyBps = event.royaltyBps;
    } else {
      royaltyBps = percentToBps(parseFloat(form.royaltyPercent) || 0);
      if (royaltyBps > 5000) return toast.danger("Royalty cannot exceed 50%.");
    }

    try {
      setBusy(true);

      // Pin a new metadata document reflecting the edits. We carry forward
      // the original image and the per-section labels unchanged (the form
      // here only edits top-level fields. Section labels are locked after
      // creation, matching the on-chain guarantee that section prices /
      // supplies are immutable aside from supply extension).
      toast.pending("Pinning updated metadata to IPFS…");
      const nextMeta = {
        ...(meta || {}),
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        image: meta?.image || null,
        attributes: [
          { trait_type: "Category", value: form.category },
          { trait_type: "Sections", value: event?.sections?.length ?? 0 },
        ],
        sections: Array.isArray(meta?.sections)
          ? meta.sections
          : (event?.sections || []).map((s, i) => ({
              name: s.name || `Section ${i + 1}`,
            })),
      };
      const metaCid = await uploadJSON(nextMeta);
      const metadataURI = toIpfsUri(metaCid);

      toast.pending("Updating event on chain…");
      await contract.updateEvent(eventId, {
        metadataURI,
        date: dateUnix,
        royaltyBps,
        maxPerBuyer,
      });
      toast.success("Event updated.");
      bump?.();
      navigate("/organise");
    } catch (err) {
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
            <label>Description</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={set("description")}
              placeholder="Short summary buyers will see on the event page…"
            />
            <div className="hint">
              Saved in the event's IPFS metadata document. Publishing an edit
              pins a new JSON and updates the event's stored URI.
            </div>
          </div>

          <div className="field">
            <label>Royalty (%) {royaltyLocked && <span className="muted">· locked</span>}</label>
            <input
              type="number" min="0" max="50" step="0.1"
              value={form.royaltyPercent}
              onChange={set("royaltyPercent")}
              disabled={royaltyLocked}
            />
            {royaltyLocked && (
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
            <div className="hint">Global cap is 10. Applies across sections.</div>
          </div>

          <div className="field row2">
            <label>Sections</label>
            <div className="muted" style={{fontSize: 13, lineHeight: 1.5}}>
              This event has <b>{event.sections?.length || 0}</b> section(s):{" "}
              {(event.sections || []).map((s, i) => (
                <span key={s.id}>
                  {i > 0 && " · "}
                  <b>{s.name}</b> ({formatETH(s.priceWei)} ETH, {s.ticketsSold}/{s.maxTickets})
                </span>
              ))}
              .{" "}
              Section names and prices are locked after creation; use the{" "}
              <Link to="/organise">dashboard</Link> "Add tickets" action to
              increase supply within a section.
            </div>
          </div>
        </div>

        <hr className="rule" />

        <div className="flex justify-between items-center">
          <span className="muted" style={{fontSize: 13}}>
            Only event-level fields are edited here. Sections are managed from the dashboard.
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
