import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastCtx = createContext(null);

let nextId = 1;

// Safety net so "pending" toasts never hang forever even if the caller
// forgets to resolve them (e.g. a wallet popup the user never closes).
const PENDING_MAX_MS = 120_000; // 2 minutes

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map()); // id -> timeoutHandle

  const remove = useCallback((id) => {
    const h = timersRef.current.get(id);
    if (h) {
      clearTimeout(h);
      timersRef.current.delete(id);
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const clearPending = useCallback(() => {
    setToasts((t) => {
      const toClear = t.filter((x) => x.type === "pending");
      toClear.forEach((x) => {
        const h = timersRef.current.get(x.id);
        if (h) {
          clearTimeout(h);
          timersRef.current.delete(x.id);
        }
      });
      return t.filter((x) => x.type !== "pending");
    });
  }, []);

  const scheduleRemoval = useCallback(
    (id, timeout) => {
      if (!timeout) return;
      const h = setTimeout(() => remove(id), timeout);
      timersRef.current.set(id, h);
    },
    [remove]
  );

  const push = useCallback(
    (message, type, timeout) => {
      // Any new resolved toast (success / danger / info) replaces pending ones.
      if (type !== "pending") clearPending();

      const id = nextId++;
      setToasts((t) => [...t, { id, message, type }]);
      scheduleRemoval(id, timeout);
      return id;
    },
    [clearPending, scheduleRemoval]
  );

  const toast = {
    info:    (m, t = 4000) => push(m, "info", t),
    success: (m, t = 4000) => push(m, "success", t),
    danger:  (m, t = 6000) => push(m, "danger", t),
    pending: (m, t = PENDING_MAX_MS) => push(m, "pending", t),
    dismiss: remove,
    dismissPending: clearPending,
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.message}</span>
            <button className="close" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be inside <ToastProvider>");
  return ctx;
}
