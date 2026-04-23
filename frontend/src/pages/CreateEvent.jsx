import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseETH, humanizeError, percentToBps } from "../utils/helpers";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";

const CATEGORIES = ["Music", "Theatre", "Sports", "Conference", "Workshop", "Community", "Other"];

export default function CreateEvent({ contract, isConnected, connect, toast, bump }) {
  const navigate = useNavigate();
  const rate = useInrRate();
  const [form, setForm] = useState({
    name: "",
    category: "Music",
    metadataURI: "",
    date: "",
    priceEth: "",
    maxTickets: "100",
    royaltyPercent: "10",
    maxPerBuyer: "4",
  });
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const priceInr = useMemo(() => {
    if (!form.priceEth) return 0;
    try { return weiToInr(parseETH(form.priceEth), rate); }
    catch { return 0; }
  }, [form.priceEth, rate]);

  const submit = async (e) => {
    e.preventDefault();
    if (!isConnected) { await connect(); return; }

    // Client-side validation mirroring the contract's require statements.
    if (!form.name.trim()) return toast.danger("Event name is required.");
    const dateUnix = Math.floor(new Date(form.date).getTime() / 1000);
    if (!dateUnix || dateUnix <= Math.floor(Date.now() / 1000))
      return toast.danger("Date must be in the future.");
    const maxTickets = parseInt(form.maxTickets, 10);
    if (!maxTickets || maxTickets < 1)
      return toast.danger("Max tickets must be > 0.");
    const royaltyBps = percentToBps(parseFloat(form.royaltyPercent) || 0);
    if (royaltyBps > 5000) return toast.danger("Royalty cannot exceed 50%.");
    const maxPerBuyer = parseInt(form.maxPerBuyer, 10);
    if (!maxPerBuyer || maxPerBuyer < 1)
      return toast.danger("Max per buyer must be ≥ 1.");

    try {
      setBusy(true);
      toast.pending("Creating event…");
      await contract.createEvent({
        name: form.name.trim(),
        category: form.category,
        metadataURI: form.metadataURI.trim(),
        date: dateUnix,
        priceWei: parseETH(form.priceEth || "0"),
        maxTickets,
        royaltyBps,
        maxPerBuyer,
      });
      toast.success("Event created successfully.");
      bump?.();
      navigate("/");
    } catch (err) {
      toast.danger(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{maxWidth: 820, margin: "0 auto"}}>
      <section className="hero" style={{marginBottom: 24}}>
        <p className="eyebrow">Organiser · Create event</p>
        <h1>Launch a new event</h1>
      </section>

      <form className="card" onSubmit={submit}>
        <div className="form-grid">
          <div className="field row2">
            <label>Event name *</label>
            <input
              type="text"
              value={form.name}
              onChange={set("name")}
              placeholder="e.g. Summer Synth Festival"
              required
            />
          </div>

          <div className="field">
            <label>Category</label>
            <select value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => (<option key={c}>{c}</option>))}
            </select>
          </div>

          <div className="field">
            <label>Date & time *</label>
            <input
              type="datetime-local"
              value={form.date}
              onChange={set("date")}
              required
            />
          </div>

          <div className="field row2">
            <label>Metadata URI</label>
            <input
              type="text"
              value={form.metadataURI}
              onChange={set("metadataURI")}
              placeholder="ipfs://bafybei…/metadata.json"
            />
            <div className="hint" style={{lineHeight: 1.55}}>
              Points at a JSON file on IPFS describing the event. The
              app renders the <code>image</code>, <code>description</code>,
              and any <code>attributes</code> on the event page.
              {" "}
              <a
                href="https://docs.pinata.cloud/web3/pinning/pinning-files"
                target="_blank"
                rel="noopener noreferrer"
              >
                How to upload to IPFS →
              </a>
            </div>
            <details style={{marginTop: 8, fontSize: 12, color: "var(--ink-500)"}}>
              <summary style={{cursor: "pointer", fontWeight: 500}}>
                Example metadata JSON
              </summary>
              <pre style={{
                margin: "8px 0 0",
                padding: 10,
                background: "var(--surface-alt)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                overflowX: "auto",
              }}>
{`{
  "name": "Summer Synth Festival",
  "description": "An open-air night of analog synths…",
  "image": "ipfs://bafybeig…/poster.png",
  "external_url": "https://mysite.com/event",
  "attributes": [
    { "trait_type": "Venue",  "value": "Riverside Grounds" },
    { "trait_type": "Doors",  "value": "7:00 PM" },
    { "trait_type": "Tier",   "value": "General Admission" }
  ]
}`}
              </pre>
            </details>
          </div>

          <div className="field">
            <label>Ticket price (ETH)</label>
            <input
              type="number" min="0" step="0.0001"
              value={form.priceEth}
              onChange={set("priceEth")}
              placeholder="0.05"
            />
            {priceInr > 0 && (
              <div className="hint">≈ {formatINR(priceInr)}</div>
            )}
          </div>

          <div className="field">
            <label>Max tickets *</label>
            <input
              type="number" min="1" step="1"
              value={form.maxTickets}
              onChange={set("maxTickets")}
              required
            />
          </div>

          <div className="field">
            <label>Royalty (%)</label>
            <input
              type="number" min="0" max="50" step="0.1"
              value={form.royaltyPercent}
              onChange={set("royaltyPercent")}
            />
            <div className="hint">Max 50%.</div>
          </div>

          <div className="field">
            <label>Max tickets per buyer</label>
            <input
              type="number" min="1" max="10" step="1"
              value={form.maxPerBuyer}
              onChange={set("maxPerBuyer")}
            />
            <div className="hint">Global ceiling: 10.</div>
          </div>
        </div>

        <hr className="rule" />

        <div className="flex justify-end items-center">
          <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
            {busy ? "Submitting…" : !isConnected ? "Connect wallet" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}
