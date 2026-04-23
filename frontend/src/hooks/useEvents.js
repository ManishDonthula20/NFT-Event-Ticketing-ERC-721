import { useState, useEffect, useCallback } from "react";

/**
 * Fetches all events from the contract.
 */
export function useEvents(contractHook, refreshKey = 0) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { getEvent, getEventCount, readContract } = contractHook;

  const refetch = useCallback(async () => {
    if (!readContract) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const count = await getEventCount();
      const promises = [];
      for (let i = 0; i < count; i++) promises.push(getEvent(i));
      const rows = (await Promise.all(promises)).filter(Boolean);
      setEvents(rows);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [readContract, getEvent, getEventCount]);

  useEffect(() => {
    refetch();
  }, [refetch, refreshKey]);

  return { events, loading, error, refetch };
}

// ---------------------------------------------------------------------------
// Utility — fetch everything we display per-ticket in parallel, but isolate
// each ticket's chain reads so one bad token cannot wipe the full list.
// ---------------------------------------------------------------------------
async function hydrateTicket(tokenId, helpers) {
  const {
    getEventOfToken,
    getResaleListing,
    tokenToEvent,
    isTicketValid,
    ownerOf,
  } = helpers;

  const results = await Promise.allSettled([
    getEventOfToken(tokenId),
    getResaleListing(tokenId),
    tokenToEvent(tokenId),
    isTicketValid(tokenId),
    ownerOf ? ownerOf(tokenId) : Promise.resolve(null),
  ]);

  const [evR, lstR, evIdR, validR, ownerR] = results;

  // If even the event lookup failed, this ticket probably no longer exists
  // (e.g. token burned). Drop it — but keep going for the others.
  if (evR.status === "rejected") return null;

  return {
    tokenId,
    eventId: evIdR.status === "fulfilled" ? evIdR.value : null,
    event: evR.value,
    listing:
      lstR.status === "fulfilled"
        ? lstR.value
        : { seller: null, price: 0n, expiresAt: 0, active: false },
    valid: validR.status === "fulfilled" ? validR.value : true,
    owner: ownerR.status === "fulfilled" ? ownerR.value : null,
  };
}

/**
 * Fetches all tickets owned by `account`.
 *
 * Robust to per-ticket read failures: uses Promise.allSettled so a single
 * broken token can't hide the other 99 tickets. Also cross-references the
 * active resale listings so a ticket the user has listed always appears on
 * this page, even if some intermediate read hiccups.
 */
export function useUserTickets(contractHook, account, refreshKey = 0) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const {
    getTicketsOfUser,
    getActiveListings,
    getEventOfToken,
    getResaleListing,
    tokenToEvent,
    isTicketValid,
    ownerOf,
    readContract,
  } = contractHook;

  const refetch = useCallback(async () => {
    if (!readContract || !account) {
      setTickets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1. Tickets the chain reports the user owns right now.
      const ownedIdsP = getTicketsOfUser(account).catch(() => []);
      // 2. Tickets listed on the resale market by this user — these are
      //    still owned on-chain, but we include them defensively so the UI
      //    never "loses" a listed ticket.
      const activeIdsP = getActiveListings().catch(() => []);
      const [ownedIds, activeIds] = await Promise.all([ownedIdsP, activeIdsP]);

      const activeOfUser = [];
      for (const id of activeIds) {
        try {
          const l = await getResaleListing(id);
          if (
            l?.seller &&
            l.seller.toLowerCase() === account.toLowerCase() &&
            l.active
          ) {
            activeOfUser.push(id);
          }
        } catch {
          // ignore individual failures
        }
      }

      // Deduplicate (Set preserves insertion order).
      const idSet = new Set([...ownedIds, ...activeOfUser]);
      const ids = Array.from(idSet);

      const rows = (
        await Promise.all(
          ids.map((tokenId) =>
            hydrateTicket(tokenId, {
              getEventOfToken,
              getResaleListing,
              tokenToEvent,
              isTicketValid,
              ownerOf,
            })
          )
        )
      ).filter(Boolean);

      // Sort by tokenId ascending for stable UI ordering.
      rows.sort((a, b) => Number(a.tokenId) - Number(b.tokenId));
      setTickets(rows);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [
    readContract,
    account,
    getTicketsOfUser,
    getActiveListings,
    getEventOfToken,
    getResaleListing,
    tokenToEvent,
    isTicketValid,
    ownerOf,
  ]);

  useEffect(() => {
    refetch();
  }, [refetch, refreshKey]);

  return { tickets, loading, error, refetch };
}

/**
 * Fetches all currently-active resale listings.
 */
export function useListings(contractHook, refreshKey = 0) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const {
    getActiveListings,
    getResaleListing,
    getEventOfToken,
    tokenToEvent,
    ownerOf,
    readContract,
  } = contractHook;

  const refetch = useCallback(async () => {
    if (!readContract) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ids = await getActiveListings();
      const rows = await Promise.all(
        ids.map(async (tokenId) => {
          const results = await Promise.allSettled([
            getResaleListing(tokenId),
            getEventOfToken(tokenId),
            tokenToEvent(tokenId),
            ownerOf(tokenId),
          ]);
          const [lstR, evR, evIdR, ownR] = results;
          if (lstR.status !== "fulfilled" || !lstR.value?.active) return null;
          if (evR.status !== "fulfilled") return null;
          return {
            tokenId,
            eventId: evIdR.status === "fulfilled" ? evIdR.value : null,
            event: evR.value,
            listing: lstR.value,
            seller: ownR.status === "fulfilled" ? ownR.value : lstR.value.seller,
          };
        })
      );
      setListings(rows.filter(Boolean));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [
    readContract,
    getActiveListings,
    getResaleListing,
    getEventOfToken,
    tokenToEvent,
    ownerOf,
  ]);

  useEffect(() => {
    refetch();
  }, [refetch, refreshKey]);

  return { listings, loading, error, refetch };
}
