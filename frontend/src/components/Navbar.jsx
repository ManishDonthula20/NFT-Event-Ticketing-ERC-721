import { NavLink, Link } from "react-router-dom";
import { formatETH } from "../utils/helpers";

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
  // Treat "restoring prior session" as "busy connecting" for UI purposes so
  // the Connect button doesn't flash on refresh before the silent attach
  // completes.
  const busy = isConnecting || isRestoring;
  return (
    <>
      <header className="nav">
        <div className="container nav-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">B</span>
            <span>Blockpass</span>
          </Link>

          <nav className="nav-links">
            <NavLink to="/"            end className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Events</NavLink>
            <NavLink to="/marketplace"      className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Marketplace</NavLink>
            <NavLink to="/my-tickets"       className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>My Tickets</NavLink>
            <NavLink to="/organise"         className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Organise</NavLink>
            <NavLink to="/create"           className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Create event</NavLink>
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
                  title="Balance of the connected wallet"
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

      {/* Mobile nav visible only < 720px */}
      <div className="container">
        <div className="mobile-nav">
          <NavLink to="/"            end className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Events</NavLink>
          <NavLink to="/marketplace"      className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Marketplace</NavLink>
          <NavLink to="/my-tickets"       className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>My Tickets</NavLink>
          <NavLink to="/organise"         className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Organise</NavLink>
          <NavLink to="/create"           className={({isActive}) => `nav-link ${isActive ? "active" : ""}`}>Create</NavLink>
        </div>
      </div>
    </>
  );
}
