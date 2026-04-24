import { useMemo, useCallback } from "react";
import { Contract, BrowserProvider, JsonRpcProvider } from "ethers";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "../utils/contract";

/**
 * useContract — wraps the deployed EventTicketNFT contract for the React app.
 *
 * Read operations always go through a read-only contract bound to the
 * connected wallet's provider (or a JSON-RPC fallback so users can browse
 * events before connecting). Write operations require a signer.
 *
 * IMPORTANT: the on-chain view `getEvent(uint256)` shadows ethers.js's
 * Contract.getEvent helper. We always call it via .getFunction("getEvent").
 */
export function useContract(signer, provider) {
  // Fallback read provider so unconnected visitors can still browse events.
  const readProvider = useMemo(() => {
    if (provider) return provider;
    try {
      return new JsonRpcProvider("http://127.0.0.1:8545");
    } catch {
      return null;
    }
  }, [provider]);

  const writeContract = useMemo(() => {
    if (!signer) return null;
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }, [signer]);

  const readContract = useMemo(() => {
    if (!readProvider) return null;
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, readProvider);
  }, [readProvider]);

  // -----------------------------------------------------------------------
  // Write functions
  // -----------------------------------------------------------------------
  const GAS_BUFFER_NUM = 125n;
  const GAS_BUFFER_DEN = 100n;

  const sendWithGasBuffer = useCallback(
    async (method, args = [], overrides = {}) => {
      if (!writeContract) throw new Error("Wallet not connected");
      const fn = writeContract.getFunction(method);
      let gasLimit;
      try {
        const estimated = await fn.estimateGas(...args, overrides);
        gasLimit = (estimated * GAS_BUFFER_NUM) / GAS_BUFFER_DEN;
      } catch (estimateErr) {
        try {
          await fn.staticCall(...args, overrides);
        } catch (staticErr) {
          throw staticErr;
        }
      }
      const finalOverrides = gasLimit ? { ...overrides, gasLimit } : overrides;
      return await fn(...args, finalOverrides);
    },
    [writeContract]
  );

  const createEvent = useCallback(
    async (params) => {
      // params.sections: [{ name, priceWei, maxTickets }, ...]
      const tx = await sendWithGasBuffer("createEvent", [
        params.name,
        params.category,
        params.metadataURI,
        params.date,
        params.royaltyBps,
        params.maxPerBuyer,
        params.sections,
      ]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const buyTicket = useCallback(
    async (eventId, sectionId, priceWei) => {
      const tx = await sendWithGasBuffer("buyTicket", [eventId, sectionId], {
        value: priceWei,
      });
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const buyMultipleTickets = useCallback(
    async (eventId, sectionId, quantity, priceWei) => {
      const totalPrice = BigInt(priceWei) * BigInt(quantity);
      const tx = await sendWithGasBuffer(
        "buyMultipleTickets",
        [eventId, sectionId, quantity],
        { value: totalPrice }
      );
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const listForResale = useCallback(
    async (tokenId, priceWei, expiresAt = 0) => {
      const tx = await sendWithGasBuffer("listForResale", [
        tokenId,
        priceWei,
        expiresAt,
      ]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const cancelResaleListing = useCallback(
    async (tokenId) => {
      const tx = await sendWithGasBuffer("cancelResaleListing", [tokenId]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const buyResaleTicket = useCallback(
    async (tokenId, priceWei) => {
      const tx = await sendWithGasBuffer("buyResaleTicket", [tokenId], {
        value: priceWei,
      });
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const addTicketsToSection = useCallback(
    async (eventId, sectionId, amount) => {
      const tx = await sendWithGasBuffer("addTicketsToSection", [
        eventId,
        sectionId,
        amount,
      ]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const updateEvent = useCallback(
    async (eventId, params) => {
      const tx = await sendWithGasBuffer("updateEvent", [
        eventId,
        params.name,
        params.category,
        params.metadataURI,
        params.date,
        params.royaltyBps,
        params.maxPerBuyer,
      ]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const cancelEvent = useCallback(
    async (eventId) => {
      const tx = await sendWithGasBuffer("cancelEvent", [eventId]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const invalidateTicket = useCallback(
    async (tokenId) => {
      const tx = await sendWithGasBuffer("invalidateTicket", [tokenId]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  // -----------------------------------------------------------------------
  // Read functions — normalise BigInt → Number where appropriate
  // -----------------------------------------------------------------------
  const normaliseSection = (s, index) => ({
    id: index,
    name: s.name,
    priceWei: s.priceWei, // keep BigInt
    maxTickets: Number(s.maxTickets),
    ticketsSold: Number(s.ticketsSold),
  });

  const getEvent = useCallback(
    async (eventId) => {
      if (!readContract) return null;
      const fn = readContract.getFunction("getEvent");
      const [ev, sections] = await Promise.all([
        fn(eventId),
        readContract.getSections(eventId).catch(() => []),
      ]);
      return {
        id: Number(eventId),
        name: ev.name,
        category: ev.category,
        metadataURI: ev.metadataURI,
        date: Number(ev.date),
        priceWei: ev.priceWei, // min section price (aggregate)
        maxTickets: Number(ev.maxTickets),
        ticketsSold: Number(ev.ticketsSold),
        royaltyBps: Number(ev.royaltyBps),
        maxPerBuyer: Number(ev.maxPerBuyer),
        organiser: ev.organiser,
        cancelled: ev.cancelled,
        sections: sections.map((s, i) => normaliseSection(s, i)),
      };
    },
    [readContract]
  );

  const getSections = useCallback(
    async (eventId) => {
      if (!readContract) return [];
      try {
        const arr = await readContract.getSections(eventId);
        return arr.map((s, i) => normaliseSection(s, i));
      } catch {
        return [];
      }
    },
    [readContract]
  );

  const getEventCount = useCallback(async () => {
    if (!readContract) return 0;
    return Number(await readContract.getEventCount());
  }, [readContract]);

  const getTokenCount = useCallback(async () => {
    if (!readContract) return 0;
    return Number(await readContract.getTokenCount());
  }, [readContract]);

  const getActiveListings = useCallback(async () => {
    if (!readContract) return [];
    const ids = await readContract.getActiveListings();
    return ids.map((x) => Number(x));
  }, [readContract]);

  const getResaleListing = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      const l = await readContract.getResaleListing(tokenId);
      return {
        seller: l.seller,
        price: l.price,
        expiresAt: Number(l.expiresAt),
        active: l.active,
      };
    },
    [readContract]
  );

  const getTicketsOfUser = useCallback(
    async (address) => {
      if (!readContract || !address) return [];
      const ids = await readContract.getTicketsOfUser(address);
      return ids.map((x) => Number(x));
    },
    [readContract]
  );

  const _fetchEventWithSections = useCallback(
    async (eventId) => {
      const [ev, sections] = await Promise.all([
        readContract.getFunction("getEvent")(eventId),
        readContract.getSections(eventId).catch(() => []),
      ]);
      return {
        name: ev.name,
        category: ev.category,
        metadataURI: ev.metadataURI,
        date: Number(ev.date),
        priceWei: ev.priceWei,
        maxTickets: Number(ev.maxTickets),
        ticketsSold: Number(ev.ticketsSold),
        royaltyBps: Number(ev.royaltyBps),
        maxPerBuyer: Number(ev.maxPerBuyer),
        organiser: ev.organiser,
        cancelled: ev.cancelled,
        sections: sections.map((s, i) => normaliseSection(s, i)),
      };
    },
    [readContract]
  );

  const getEventOfToken = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      // Prefer the direct getEventOfToken, but sections need a separate read.
      // Fall back to tokenToEvent if the direct getter reverts (e.g. burn).
      try {
        const eventId = await readContract.tokenToEvent(tokenId);
        return await _fetchEventWithSections(eventId);
      } catch {
        return null;
      }
    },
    [readContract, _fetchEventWithSections]
  );

  const tokenToEvent = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      return Number(await readContract.tokenToEvent(tokenId));
    },
    [readContract]
  );

  const tokenToSection = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      return Number(await readContract.tokenToSection(tokenId));
    },
    [readContract]
  );

  const getSectionOfToken = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      try {
        const s = await readContract.getSectionOfToken(tokenId);
        const id = await readContract.tokenToSection(tokenId);
        return normaliseSection(s, Number(id));
      } catch {
        return null;
      }
    },
    [readContract]
  );

  const ownerOf = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      return await readContract.ownerOf(tokenId);
    },
    [readContract]
  );

  const isTicketValid = useCallback(
    async (tokenId) => {
      if (!readContract) return false;
      return await readContract.isTicketValid(tokenId);
    },
    [readContract]
  );

  const ticketsBoughtBy = useCallback(
    async (user, eventId) => {
      if (!readContract || !user) return 0;
      return Number(await readContract.ticketsBoughtBy(user, eventId));
    },
    [readContract]
  );

  return {
    readContract,
    writeContract,
    // writes
    createEvent,
    buyTicket,
    buyMultipleTickets,
    listForResale,
    cancelResaleListing,
    buyResaleTicket,
    addTicketsToSection,
    updateEvent,
    cancelEvent,
    invalidateTicket,
    // reads
    getEvent,
    getSections,
    getEventCount,
    getTokenCount,
    getActiveListings,
    getResaleListing,
    getTicketsOfUser,
    getEventOfToken,
    getSectionOfToken,
    tokenToEvent,
    tokenToSection,
    ownerOf,
    isTicketValid,
    ticketsBoughtBy,
  };
}
