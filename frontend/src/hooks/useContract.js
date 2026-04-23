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
  //
  // Gas strategy: ethers v6 uses the raw eth_estimateGas result as the tx
  // gas limit, which can leave only ~1–3% headroom. State that changes
  // between estimation and mining (e.g. a zero→non-zero SSTORE that another
  // tx already triggered) can then push real usage past the limit and
  // cause an out-of-gas revert the sender still pays for. We estimate
  // explicitly and add a 25% buffer before dispatching.
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
        // Some public RPCs strip revert reasons from estimateGas responses
        // ("missing revert data"). Fall back to a read-only eth_call via
        // staticCall, which on many providers DOES return the reason.
        // Doing this before sending means the user sees a useful error
        // instead of paying gas for an OOG-style failure in the wallet.
        try {
          await fn.staticCall(...args, overrides);
        } catch (staticErr) {
          // staticCall usually surfaces err.revert.args[0] / err.reason
          // with the actual require() string — let humanizeError pick it up.
          throw staticErr;
        }
        // staticCall succeeded but estimateGas failed — highly unusual.
        // Proceed without a manual gas limit and let the wallet estimate.
      }
      const finalOverrides = gasLimit ? { ...overrides, gasLimit } : overrides;
      return await fn(...args, finalOverrides);
    },
    [writeContract]
  );

  const createEvent = useCallback(
    async (params) => {
      const tx = await sendWithGasBuffer("createEvent", [
        params.name,
        params.category,
        params.metadataURI,
        params.date,
        params.priceWei,
        params.maxTickets,
        params.royaltyBps,
        params.maxPerBuyer,
      ]);
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const buyTicket = useCallback(
    async (eventId, priceWei) => {
      const tx = await sendWithGasBuffer("buyTicket", [eventId], {
        value: priceWei,
      });
      return await tx.wait();
    },
    [sendWithGasBuffer]
  );

  const buyMultipleTickets = useCallback(
    async (eventId, quantity, priceWei) => {
      const totalPrice = BigInt(priceWei) * BigInt(quantity);
      const tx = await sendWithGasBuffer(
        "buyMultipleTickets",
        [eventId, quantity],
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

  const addTickets = useCallback(
    async (eventId, amount) => {
      const tx = await sendWithGasBuffer("addTickets", [eventId, amount]);
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
        params.priceWei,
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
  const getEvent = useCallback(
    async (eventId) => {
      if (!readContract) return null;
      const fn = readContract.getFunction("getEvent");
      const ev = await fn(eventId);
      return {
        id: Number(eventId),
        name: ev.name,
        category: ev.category,
        metadataURI: ev.metadataURI,
        date: Number(ev.date),
        priceWei: ev.priceWei, // keep BigInt
        maxTickets: Number(ev.maxTickets),
        ticketsSold: Number(ev.ticketsSold),
        royaltyBps: Number(ev.royaltyBps),
        maxPerBuyer: Number(ev.maxPerBuyer),
        organiser: ev.organiser,
        cancelled: ev.cancelled,
      };
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

  const getEventOfToken = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      // If the token doesn't exist (e.g. burn or redeploy) the contract
      // reverts; fall back to deriving the event from tokenToEvent so one
      // stale id cannot break the whole MyTickets page.
      try {
        const ev = await readContract.getEventOfToken(tokenId);
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
        };
      } catch {
        try {
          const eventId = await readContract.tokenToEvent(tokenId);
          const ev = await readContract.getFunction("getEvent")(eventId);
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
          };
        } catch {
          return null;
        }
      }
    },
    [readContract]
  );

  const tokenToEvent = useCallback(
    async (tokenId) => {
      if (!readContract) return null;
      return Number(await readContract.tokenToEvent(tokenId));
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
    addTickets,
    updateEvent,
    cancelEvent,
    invalidateTicket,
    // reads
    getEvent,
    getEventCount,
    getTokenCount,
    getActiveListings,
    getResaleListing,
    getTicketsOfUser,
    getEventOfToken,
    tokenToEvent,
    ownerOf,
    isTicketValid,
    ticketsBoughtBy,
  };
}
