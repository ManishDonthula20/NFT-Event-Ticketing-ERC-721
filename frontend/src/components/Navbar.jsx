import { NavLink, Link } from "react-router-dom";
import { formatETH } from "../utils/helpers";

/**
 * Top navigation. Intentionally keeps any wallet-identifying info off-screen
 * (no address, no network id). We only show a connection status indicator
 * and the connected balance so the user can tell their wallet is attached
 * without exposing their account to a shoulder-surfer.
 */
export default function Navbar({
  account,
  balance,
  isConnecting,
  isRestoring,
  isCorrectNetwork,
  connect,
  disconnect,
  switchNetwork,
}) {
  const busy = isConnecting || isRestoring;
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand" title="BookYourShow">
            <span className="brand-mark" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 64 64" fill="currentColor">
                <path d="M17 24 L28 32 L17 40 Z" />
                <circle cx="47" cy="32" r="3" />
              </svg>
            </span>
            <span>BookYourShow</span>
          </Link>

          <nav className="nav-links">
            <NavLink to="/" end            className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Home</NavLink>
            <NavLink to="/events"          className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Events</NavLink>
            <NavLink to="/marketplace"     className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Resale</NavLink>
            <NavLink to="/my-tickets"      className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>My Tickets</NavLink>
            <NavLink to="/organise"        className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Organise</NavLink>
            <NavLink to="/create"          className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Create event</NavLink>
          </nav>

          <div className="flex items-center gap-12">
            {account ? (
              <>
                {!isCorrectNetwork && (
                  <button className="btn btn-sm btn-ghost" onClick={switchNetwork}>
                    Switch network
                  </button>
                )}
                <span
                  className={`wallet-chip ${isCorrectNetwork ? "" : "warn"}`}
                  title={isCorrectNetwork ? "Wallet connected" : "Wrong network"}
                >
                  <span className="dot" />
                  {balance !== null ? `${formatETH(balance, 4)} ETH` : "Connected"}
                </span>
                <button className="btn btn-sm btn-ghost" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                onClick={connect}
                disabled={busy}
              >
                {busy ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="container">
        <div className="mobile-nav">
          <NavLink to="/" end            className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Home</NavLink>
          <NavLink to="/events"          className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Events</NavLink>
          <NavLink to="/marketplace"     className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Resale</NavLink>
          <NavLink to="/my-tickets"      className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>My Tickets</NavLink>
          <NavLink to="/organise"        className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Organise</NavLink>
          <NavLink to="/create"          className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Create</NavLink>
        </div>
      </div>
    </>
  );
}
