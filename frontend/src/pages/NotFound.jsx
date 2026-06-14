import { Link, useLocation } from "react-router-dom";

/**
 *  Catch-all 404 page.
 *
 *  Rendered by the `*` route in App.jsx whenever the user lands on a path
 *  that doesn't match any known route. Gives them a clear explanation and
 *  obvious ways back into the app instead of an empty screen.
 */
export default function NotFound() {
  const location = useLocation();

  return (
    <section
      className="card"
      style={{
        background: "linear-gradient(135deg, var(--surface-alt), var(--surface))",
        textAlign: "center",
        padding: "56px 36px",
        maxWidth: 640,
        margin: "32px auto",
      }}
    >
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: "clamp(3.5rem, 12vw, 6rem)",
          lineHeight: 1,
          fontWeight: 700,
        }}
      >
        404
      </div>
      <h1 style={{ fontSize: "1.7rem", marginTop: 12 }}>Page not found</h1>
      <p className="muted" style={{ maxWidth: 460, margin: "12px auto 8px", lineHeight: 1.6 }}>
        We couldn't find the page you were looking for. It may have been moved,
        removed, or the link might be broken.
      </p>
      {location?.pathname && (
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 24 }}>
          Requested path: <code>{location.pathname}</code>
        </p>
      )}
      <div className="flex gap-12" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <Link to="/" className="btn btn-primary btn-lg">
          Back home
        </Link>
        <Link to="/events" className="btn btn-ghost btn-lg">
          Browse events
        </Link>
        <Link to="/marketplace" className="btn btn-ghost btn-lg">
          Resale marketplace
        </Link>
      </div>
    </section>
  );
}
