import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseETH, humanizeError, percentToBps } from "../utils/helpers";
import { useInrRate, weiToInr, formatINR } from "../hooks/useCurrency";
import { uploadFile, uploadJSON, toIpfsUri, ipfsUploadStatus } from "../utils/ipfsUpload";

const CATEGORIES = ["Music", "Theatre", "Sports", "Conference", "Workshop", "Community", "Other"];

// Default section preset shown on first render. Always at least one section
// is required, so we seed a "General" tier the organiser can edit or remove.
const defaultSection = () => ({ name: "General", priceEth: "", maxTickets: "100" });

export default function CreateEvent({ contract, isConnected, connect, toast, bump }) {
  const navigate = useNavigate();
  const rate = useInrRate();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    name: "",
    category: "Music",
    description: "",
    date: "",
    royaltyPercent: "10",
    maxPerBuyer: "4",
  });
  const [sections, setSections] = useState([defaultSection()]);

  // Image + IPFS upload state
  const [image, setImage] = useState(null); // { file, previewUrl, cid | null }
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setSectionField = (idx, key, value) => {
    setSections((list) =>
      list.map((s, i) => (i === idx ? { ...s, [key]: value } : s))
    );
  };

  const addSection = () => {
    setSections((list) => [
      ...list,
      { name: "", priceEth: "", maxTickets: "" },
    ]);
  };

  const removeSection = (idx) => {
    setSections((list) => (list.length <= 1 ? list : list.filter((_, i) => i !== idx)));
  };

  const cheapestPriceInr = useMemo(() => {
    try {
      const prices = sections
        .map((s) => (s.priceEth ? parseETH(s.priceEth) : null))
        .filter((p) => p !== null && p > 0n);
      if (!prices.length) return 0;
      const min = prices.reduce((a, b) => (a < b ? a : b));
      return weiToInr(min, rate);
    } catch {
      return 0;
    }
  }, [sections, rate]);

  const totalTickets = useMemo(
    () =>
      sections.reduce((acc, s) => {
        const n = parseInt(s.maxTickets, 10);
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [sections]
  );

  // --------- Image handling ---------
  const onImageSelected = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.danger("Please select an image file.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.danger("Image is larger than 6 MB. Pick a smaller file.");
      return;
    }
    setImage({
      file,
      previewUrl: URL.createObjectURL(file),
      cid: null,
    });
  };

  const clearImage = () => {
    if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    setImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!isConnected) { await connect(); return; }

    if (!form.name.trim()) return toast.danger("Event name is required.");
    if (!form.description.trim())
      return toast.danger("Please add a short description so buyers know what the event is about.");
    const dateUnix = Math.floor(new Date(form.date).getTime() / 1000);
    if (!dateUnix || dateUnix <= Math.floor(Date.now() / 1000) + 86400)
      return toast.danger("Date must be at least 1 day in the future.");
    const royaltyBps = percentToBps(parseFloat(form.royaltyPercent) || 0);
    if (royaltyBps > 5000) return toast.danger("Royalty cannot exceed 50%.");
    const maxPerBuyer = parseInt(form.maxPerBuyer, 10);
    if (!maxPerBuyer || maxPerBuyer < 1)
      return toast.danger("Max per buyer must be ≥ 1.");

    if (!sections.length) return toast.danger("Add at least one section.");

    const payloadSections = [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s.name.trim())
        return toast.danger(`Section ${i + 1}: name is required.`);
      const max = parseInt(s.maxTickets, 10);
      if (!max || max < 1)
        return toast.danger(`Section "${s.name}": tickets must be ≥ 1.`);
      let priceWei;
      try {
        priceWei = parseETH(s.priceEth || "0");
      } catch {
        return toast.danger(`Section "${s.name}": invalid price.`);
      }
      payloadSections.push({
        name: s.name.trim(),
        priceWei,
        maxTickets: max,
      });
    }

    try {
      setBusy(true);

      // Everything that isn't required for on-chain logic (name, description,
      // category, section labels, banner image) lives in this JSON document
      // that we pin to IPFS. The contract only sees the resulting URI.
      setUploading(true);
      let imageUri = null;
      if (image?.file) {
        toast.pending("Uploading image to IPFS…");
        const imageCid = await uploadFile(image.file);
        imageUri = `ipfs://${imageCid}`;
        setImage((img) => (img ? { ...img, cid: imageCid } : img));
      }

      toast.pending("Pinning event metadata to IPFS…");
      const metaCid = await uploadJSON({
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        image: imageUri,
        attributes: [
          { trait_type: "Category", value: form.category },
          { trait_type: "Sections", value: sections.length },
        ],
        sections: sections.map((s) => ({ name: s.name.trim() })),
      });
      const metadataURI = toIpfsUri(metaCid);
      setUploading(false);

      toast.pending("Creating event on chain…");
      await contract.createEvent({
        metadataURI,
        date: dateUnix,
        royaltyBps,
        maxPerBuyer,
        sections: payloadSections, // chain only needs priceWei + maxTickets
      });
      toast.success("Event created successfully.");
      bump?.();
      navigate("/events");
    } catch (err) {
      toast.danger(humanizeError(err));
      setUploading(false);
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

          <div className="field row2">
            <label>Description *</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={set("description")}
              placeholder="Tell buyers what your event is about, the vibe, the lineup, anything they should know…"
              required
            />
            <div className="hint">
              Stored in the event's IPFS metadata document alongside the
              banner image. Content-addressed, so it cannot be tampered
              with after creation — and much cheaper than storing on chain.
            </div>
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
            <label>Event banner</label>
            <div
              className="card"
              style={{
                padding: 14,
                background: "var(--surface-alt)",
                border: "1px dashed var(--border-strong)",
              }}
            >
              {image?.previewUrl ? (
                <div>
                  <img
                    src={image.previewUrl}
                    alt="selected"
                    style={{
                      width: "100%",
                      maxHeight: 220,
                      objectFit: "cover",
                      borderRadius: 8,
                      marginBottom: 10,
                    }}
                  />
                  <div className="flex gap-8" style={{flexWrap: "wrap"}}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                    >
                      Replace image
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={clearImage}
                      disabled={busy}
                    >
                      Remove
                    </button>
                    {image.cid && (
                      <span
                        className="muted"
                        style={{fontSize: 12, marginLeft: "auto"}}
                      >
                        pinned to IPFS
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-col gap-8" style={{alignItems: "flex-start"}}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy}
                  >
                    Choose an image…
                  </button>
                  <div className="hint" style={{lineHeight: 1.55}}>
                    When you submit, BookYourShow uploads this image plus a
                    metadata JSON to IPFS using <b>{ipfsUploadStatus()}</b>{" "}
                    and stores the resulting link on-chain. PNG/JPG/WebP,
                    up to 6 MB.
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{display: "none"}}
                onChange={(e) => onImageSelected(e.target.files?.[0])}
              />
            </div>
          </div>

          <div className="field">
            <label>Royalty (%)</label>
            <input
              type="number" min="0" max="50" step="0.1"
              value={form.royaltyPercent}
              onChange={set("royaltyPercent")}
            />
            <div className="hint">Max 50%. Paid to you on every resale.</div>
          </div>

          <div className="field">
            <label>Max tickets per buyer</label>
            <input
              type="number" min="1" max="10" step="1"
              value={form.maxPerBuyer}
              onChange={set("maxPerBuyer")}
            />
            <div className="hint">
              Applies across all sections. Global ceiling: 10.
            </div>
          </div>
        </div>

        <hr className="rule" />

        <div className="section-header" style={{marginBottom: 12}}>
          <div>
            <h2 style={{fontSize: "1.2rem"}}>Sections</h2>
            <div className="aside">
              Split your event into divisions (e.g. VIP, Regular, Economy).
              Each section has its own name, price and ticket count.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={addSection}
          >
            + Add section
          </button>
        </div>

        <div className="flex-col gap-12" style={{marginBottom: 16}}>
          {sections.map((s, i) => {
            let inrPerTicket = 0;
            try {
              if (s.priceEth) inrPerTicket = weiToInr(parseETH(s.priceEth), rate);
            } catch { /* ignore */ }
            return (
              <div
                key={i}
                className="card"
                style={{padding: 16, background: "var(--surface-alt)"}}
              >
                <div className="flex justify-between items-center" style={{marginBottom: 10}}>
                  <span className="tag neutral">Section {i + 1}</span>
                  {sections.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => removeSection(i)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>Name *</label>
                    <input
                      type="text"
                      value={s.name}
                      onChange={(e) => setSectionField(i, "name", e.target.value)}
                      placeholder="VIP / Regular / Economy"
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Price (ETH)</label>
                    <input
                      type="number" min="0" step="0.0001"
                      value={s.priceEth}
                      onChange={(e) => setSectionField(i, "priceEth", e.target.value)}
                      placeholder="0.05"
                    />
                    {inrPerTicket > 0 && (
                      <div className="hint">≈ {formatINR(inrPerTicket)}</div>
                    )}
                  </div>
                  <div className="field">
                    <label>Tickets in this section *</label>
                    <input
                      type="number" min="1" step="1"
                      value={s.maxTickets}
                      onChange={(e) => setSectionField(i, "maxTickets", e.target.value)}
                      placeholder="100"
                      required
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center" style={{fontSize: 13, color: "var(--ink-500)"}}>
          <span>
            <b>{sections.length}</b> section{sections.length !== 1 ? "s" : ""} ·{" "}
            <b>{totalTickets}</b> total tickets
          </span>
          {cheapestPriceInr > 0 && (
            <span>from ≈ {formatINR(cheapestPriceInr)} / ticket</span>
          )}
        </div>

        <hr className="rule" />

        <div className="flex justify-end items-center">
          <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
            {busy
              ? uploading ? "Uploading to IPFS…" : "Submitting…"
              : !isConnected ? "Connect wallet" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}
