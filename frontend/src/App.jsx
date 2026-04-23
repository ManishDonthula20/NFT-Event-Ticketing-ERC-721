import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Navbar from "./components/Navbar";
import { ToastProvider, useToast } from "./components/Toast";
import { useWallet } from "./hooks/useWallet";
import { useContract } from "./hooks/useContract";
import { CurrencyProvider } from "./hooks/useCurrency";
import { NETWORK_NAME, CHAIN_ID } from "./utils/contract";

import Home from "./pages/Home";
import EventDetails from "./pages/EventDetails";
import MyTickets from "./pages/MyTickets";
import Marketplace from "./pages/Marketplace";
import CreateEvent from "./pages/CreateEvent";
import Organiser from "./pages/Organiser";
import EditEvent from "./pages/EditEvent";

function AppInner() {
  const wallet = useWallet();
  const contract = useContract(wallet.signer, wallet.provider);
  const toast = useToast();

  // `refreshKey` bumps whenever a successful write occurs, which causes all
  // read hooks to refetch so the UI stays in sync with chain state.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  // Refresh balance whenever refreshKey changes (post-tx).
  useEffect(() => {
    if (wallet.account) wallet.refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return (
    <BrowserRouter>
      <div className="layout">
        <Navbar {...wallet} />
        <main className="main">
          <div className="container">
            {wallet.account && !wallet.isCorrectNetwork && (
              <div className="alert warn mb-24">
                <span>
                  Wrong network — please switch to <b>{NETWORK_NAME}</b> (chain id&nbsp;
                  <span className="mono">{CHAIN_ID}</span>).
                </span>
                <button
                  className="btn btn-sm btn-accent"
                  style={{marginLeft: "auto"}}
                  onClick={wallet.switchNetwork}
                >
                  Switch
                </button>
              </div>
            )}
            {wallet.error && (
              <div className="alert danger mb-24">{wallet.error}</div>
            )}
            <Routes>
              <Route path="/" element={<Home contract={contract} refreshKey={refreshKey} />} />
              <Route path="/event/:id" element={
                <EventDetails
                  contract={contract}
                  account={wallet.account}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  bump={bump}
                />
              } />
              <Route path="/my-tickets" element={
                <MyTickets
                  contract={contract}
                  account={wallet.account}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  refreshKey={refreshKey}
                  bump={bump}
                />
              } />
              <Route path="/marketplace" element={
                <Marketplace
                  contract={contract}
                  account={wallet.account}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  refreshKey={refreshKey}
                  bump={bump}
                />
              } />
              <Route path="/create" element={
                <CreateEvent
                  contract={contract}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  bump={bump}
                />
              } />
              <Route path="/organise" element={
                <Organiser
                  contract={contract}
                  account={wallet.account}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  refreshKey={refreshKey}
                  bump={bump}
                />
              } />
              <Route path="/organise/edit/:id" element={
                <EditEvent
                  contract={contract}
                  account={wallet.account}
                  isConnected={wallet.isConnected}
                  connect={wallet.connect}
                  toast={toast}
                  bump={bump}
                />
              } />
              <Route path="*" element={
                <div className="empty">
                  <h3>Page not found</h3>
                  <p>The path you requested doesn't exist.</p>
                  <Link to="/" className="btn btn-primary">Back home</Link>
                </div>
              } />
            </Routes>
          </div>
        </main>
        <footer className="footer">
          <div className="container footer-inner">
            <span>Blockpass · NFT event ticketing</span>
            <span className="mono">{NETWORK_NAME}</span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <CurrencyProvider>
        <AppInner />
      </CurrencyProvider>
    </ToastProvider>
  );
}
