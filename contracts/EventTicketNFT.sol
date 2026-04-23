// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  EventTicketNFT
 * @author CS 218 — Team RIP Scrooge
 * @notice NFT-based event ticketing system implementing ERC-721 ownership and
 *         ERC-2981 on-chain royalties. Includes an internal resale marketplace
 *         with royalty-deducting settlement, anti-scalping per-buyer caps,
 *         organiser check-in (invalidation), batch buying, and IPFS metadata.
 * @dev    All monetary amounts are in wei. Royalty is expressed in basis points
 *         (10_000 == 100%). Full NatSpec on every public/external function.
 *         Storage design keeps all heavy content off-chain: only an IPFS CID is
 *         stored per event; token URIs are derived from that CID + tokenId.
 */
contract EventTicketNFT is ERC721URIStorage, IERC2981, ReentrancyGuard, Ownable {

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Upper global bound on how many tickets a single address may
    ///         hold for any one event (anti-scalping safety rail).
    uint32 public constant GLOBAL_MAX_PER_BUYER = 10;

    /// @notice Maximum royalty that can be set (50 % of sale price).
    uint96 public constant MAX_ROYALTY_BPS = 5_000;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice On-chain record for a single event.
    struct EventInfo {
        string  name;          // Short human-readable title
        string  category;      // e.g. "Music", "Sports"
        string  metadataURI;   // IPFS URI with description, banner, poster
        uint256 date;          // Unix timestamp; tickets cannot be bought past this
        uint256 priceWei;      // Primary-sale price in wei
        uint256 maxTickets;    // Hard supply cap
        uint256 ticketsSold;   // Running counter of minted tickets
        uint96  royaltyBps;    // EIP-2981 royalty (basis points)
        uint32  maxPerBuyer;   // Per-address purchase cap for this event
        address organiser;     // Address that receives primary sale revenue + royalties
        bool    cancelled;     // If true, event cannot be purchased or resold
    }

    /// @notice Resale-market listing for a ticket on the internal marketplace.
    struct ResaleListing {
        address seller;     // Current owner at the time of listing
        uint256 price;      // Asking price in wei
        uint256 expiresAt;  // Unix timestamp; 0 == no expiry
        bool    active;     // False after cancel or sale
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 private _eventIdCounter;
    uint256 private _tokenIdCounter;

    /// @notice eventId → EventInfo
    mapping(uint256 => EventInfo) private _events;

    /// @notice tokenId → eventId it belongs to
    mapping(uint256 => uint256) public tokenToEvent;

    /// @notice tokenId → is ticket still valid (organiser can invalidate on entry)
    mapping(uint256 => bool) public ticketValid;

    /// @notice tokenId → resale listing
    mapping(uint256 => ResaleListing) private _resale;

    /// @notice (buyer,eventId) → tickets purchased — anti-scalping accounting
    mapping(address => mapping(uint256 => uint256)) public ticketsOwnedByBuyer;
    /// @notice (tokenid,timestamp) -> ticket purchased to time stamp until when it is valid, can be resold or bought only if the current timestamp is less than the timestamp until when it is valid. Create a view to show this i guess. we will check tmro.
    mapping(uint256 => uint256) public validity;

    /// @notice Running list of active resale listings (tokenIds) for cheap enumeration.
    uint256[] private _activeListings;
    mapping(uint256 => uint256) private _activeListingIndex; // tokenId → idx+1 (0 = not present)

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event EventCreated(
        uint256 indexed eventId,
        address indexed organiser,
        string name,
        string category,
        uint256 date,
        uint256 priceWei,
        uint256 maxTickets,
        uint96  royaltyBps
    );

    event TicketMinted(
        uint256 indexed tokenId,
        uint256 indexed eventId,
        address indexed buyer,
        uint256 pricePaid
    );

    event TicketListedForResale(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price,
        uint256 expiresAt
    );

    event ResaleListingCancelled(uint256 indexed tokenId, address indexed seller);

    event TicketResold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 royaltyPaid
    );

    event TicketInvalidated(uint256 indexed tokenId, address indexed organiser);

    event EventCancelled(uint256 indexed eventId, address indexed organiser);

    event TicketsAdded(uint256 indexed eventId, uint256 addedAmount, uint256 newTotal);

    event EventUpdated(uint256 indexed eventId, address indexed organiser);

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier eventExists(uint256 eventId) {
        require(eventId < _eventIdCounter, "Event does not exist");
        _;
    }

    modifier onlyOrganiser(uint256 eventId) {
        require(_events[eventId].organiser == msg.sender, "Caller is not organiser");
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @notice Deploys the collection with a symbolic name/symbol.
    constructor() ERC721("EventTicket", "ETKT") Ownable(msg.sender) {}

    // =====================================================================
    //                        ORGANISER ACTIONS
    // =====================================================================

    /**
     * @notice Creates a new event. Any address can call; the caller becomes the
     *         organiser for that event and will receive primary-sale revenue
     *         plus EIP-2981 royalties from resales.
     * @param  name         Human-readable title of the event.
     * @param  category     Short category label (used by frontend filter).
     * @param  metadataURI  IPFS URI (e.g. "ipfs://<CID>") pointing to JSON with
     *                      description, banner image URL, location, etc. The
     *                      image/description itself MUST NOT be stored on-chain.
     * @param  date         Unix timestamp of the event; must be in the future.
     * @param  priceWei     Primary-sale price in wei (may be zero for free events).
     * @param  maxTickets   Hard supply cap; must be > 0.
     * @param  royaltyBps   EIP-2981 royalty share in basis points (≤ MAX_ROYALTY_BPS).
     * @param  maxPerBuyer  Per-address purchase cap; capped by GLOBAL_MAX_PER_BUYER.
     * @return eventId      The numeric id assigned to the newly created event.
     */
    function createEvent(
        string calldata name,
        string calldata category,
        string calldata metadataURI,
        uint256 date,
        uint256 priceWei,
        uint256 maxTickets,
        uint96  royaltyBps,
        uint32  maxPerBuyer
    ) external returns (uint256 eventId) {
        require(bytes(name).length != 0, "Name required");
        // Enforce at least a 24h lead-time so buyers have a chance to react and
        // to prevent "create-and-drain" flash events.
        require(date > block.timestamp + 1 days, "Event must be at least 1 day in the future");
        require(maxTickets > 0, "maxTickets must be > 0");
        require(royaltyBps <= MAX_ROYALTY_BPS, "Royalty exceeds cap");
        require(maxPerBuyer > 0, "maxPerBuyer must be > 0");
        // Hard-fail instead of silently clamping: the organiser should know
        // exactly what cap is applied to their event.
        require(maxPerBuyer <= GLOBAL_MAX_PER_BUYER, "maxPerBuyer exceeds global cap");

        eventId = _eventIdCounter;
        // Safe: uint256 cannot realistically overflow from this increment.
        unchecked { _eventIdCounter = eventId + 1; }

        _events[eventId] = EventInfo({
            name:         name,
            category:     category,
            metadataURI:  metadataURI,
            date:         date,
            priceWei:     priceWei,
            maxTickets:   maxTickets,
            ticketsSold:  0,
            royaltyBps:   royaltyBps,
            maxPerBuyer:  maxPerBuyer,
            organiser:    msg.sender,
            cancelled:    false
        });

        emit EventCreated(
            eventId,
            msg.sender,
            name,
            category,
            date,
            priceWei,
            maxTickets,
            royaltyBps
        );
    }

    /**
     * @notice Updates editable fields on an existing event. Organiser-only.
     * @dev    Safety rules:
     *          - `name` / `category` / `metadataURI` / `date` / `maxPerBuyer`
     *            are always editable (while the event is live and uncancelled).
     *          - `priceWei` and `royaltyBps` may ONLY be changed while
     *            `ticketsSold == 0`, otherwise we'd be rewriting terms on
     *            existing holders mid-event (unfair and a griefing vector).
     *          - The organiser address is intentionally immutable — see the
     *            royalty design in `royaltyInfo`.
     * @param  eventId         Id of the event to update.
     * @param  name            New name (non-empty).
     * @param  category        New category label.
     * @param  metadataURI     New IPFS metadata URI.
     * @param  newDate         New unix timestamp (> now + 1 day).
     * @param  newPriceWei     New primary-sale price (ignored if tickets sold).
     * @param  newRoyaltyBps   New royalty bps (ignored if tickets sold).
     * @param  newMaxPerBuyer  New per-address cap (1 ≤ v ≤ GLOBAL_MAX_PER_BUYER).
     */
    function updateEvent(
        uint256 eventId,
        string calldata name,
        string calldata category,
        string calldata metadataURI,
        uint256 newDate,
        uint256 newPriceWei,
        uint96  newRoyaltyBps,
        uint32  newMaxPerBuyer
    )
        external
        eventExists(eventId)
        onlyOrganiser(eventId)
    {
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(bytes(name).length != 0, "Name required");
        require(newDate > block.timestamp + 1 days, "Event must be at least 1 day in the future");
        require(newRoyaltyBps <= MAX_ROYALTY_BPS, "Royalty exceeds cap");
        require(newMaxPerBuyer > 0, "maxPerBuyer must be > 0");
        require(newMaxPerBuyer <= GLOBAL_MAX_PER_BUYER, "maxPerBuyer exceeds global cap");

        if (ev.priceWei != newPriceWei || ev.royaltyBps != newRoyaltyBps) {
            require(ev.ticketsSold == 0, "Price/royalty locked after first sale");
            ev.priceWei    = newPriceWei;
            ev.royaltyBps  = newRoyaltyBps;
        }

        ev.name         = name;
        ev.category     = category;
        ev.metadataURI  = metadataURI;
        ev.date         = newDate;
        ev.maxPerBuyer  = newMaxPerBuyer;

        emit EventUpdated(eventId, msg.sender);
    }

    /**
     * @notice Increases the ticket supply for an event the caller organises.
     * @param  eventId  Id of the event to extend.
     * @param  amount   Number of additional tickets to make available (> 0).
     */
    function addTickets(uint256 eventId, uint256 amount)
        external
        eventExists(eventId)
        onlyOrganiser(eventId)
    {
        require(amount > 0, "amount must be > 0");
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(block.timestamp < ev.date, "Event already finished");

        ev.maxTickets += amount;
        emit TicketsAdded(eventId, amount, ev.maxTickets);
    }

    /**
     * @notice Cancels an event. No further primary sales or resales will be
     *         allowed. Existing ticket holders keep their NFTs but cannot
     *         trade them on the internal marketplace.
     * @dev    IMPORTANT: this does NOT refund past buyers. Primary-sale ETH
     *         is forwarded to the organiser at purchase time, so the contract
     *         holds no funds to refund from. A refund flow would require an
     *         escrow model (see docs/EXPLAINER.md §"Cancellations & refunds").
     * @param  eventId Id of the event to cancel.
     */
    function cancelEvent(uint256 eventId)
        external
        eventExists(eventId)
        onlyOrganiser(eventId)
    {
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Already cancelled");
        ev.cancelled = true;
        emit EventCancelled(eventId, msg.sender);
    }

    /**
     * @notice Invalidates a ticket so it can no longer be resold or re-used
     *         (intended for venue check-in). Callable by the event organiser
     *         or the contract owner (platform admin).
     * @param  tokenId The ticket token id.
     */
    function invalidateTicket(uint256 tokenId) external {
        uint256 eventId = tokenToEvent[tokenId];
        address organiser = _events[eventId].organiser;
        require(organiser != address(0), "Unknown ticket");
        require(msg.sender == organiser || msg.sender == owner(), "Not authorised");
        require(ticketValid[tokenId], "Already invalid");

        ticketValid[tokenId] = false;
        _removeListingIfActive(tokenId);
        emit TicketInvalidated(tokenId, msg.sender);
    }

    // =====================================================================
    //                          PRIMARY SALE
    // =====================================================================

    /**
     * @notice Purchases a single ticket for `eventId`. The caller must send at
     *         least `priceWei`; excess is refunded.
     * @dev    Thin wrapper over `_buy` so the single-ticket ABI stays intact.
     *         Reentrancy-guarded because ETH leaves the contract.
     * @param  eventId The event to buy a ticket for.
     * @return tokenId The id of the freshly minted ERC-721 ticket.
     */
    function buyTicket(uint256 eventId)
        external
        payable
        nonReentrant
        eventExists(eventId)
        returns (uint256 tokenId)
    {
        tokenId = _buy(eventId, 1);
    }

    /**
     * @notice Purchases multiple tickets for a single event in one transaction.
     *         Respects both the global supply cap and per-buyer cap.
     * @param  eventId  The event to buy tickets for.
     * @param  quantity Number of tickets (>= 1).
     * @return firstTokenId Id of the first minted ticket; subsequent tickets
     *                      are sequentially numbered.
     */
    function buyMultipleTickets(uint256 eventId, uint256 quantity)
        external
        payable
        nonReentrant
        eventExists(eventId)
        returns (uint256 firstTokenId)
    {
        require(quantity > 0, "quantity must be > 0");
        firstTokenId = _buy(eventId, quantity);
    }

    /**
     * @dev Shared primary-sale path used by both `buyTicket` (quantity = 1)
     *      and `buyMultipleTickets`. Not `nonReentrant` itself — the public
     *      entry points carry the guard. Uses checks-effects-interactions:
     *      all state (mints, counters, URIs) is finalised inside
     *      `_mintTicket` before any ETH is forwarded.
     *
     *      Excess ETH is refunded defensively: the front-end always sends
     *      exact payment, but third-party callers (contracts, other UIs,
     *      relayers) might not, and stuck ETH is a worse outcome than a
     *      ~400 gas branch.
     */
    function _buy(uint256 eventId, uint256 quantity)
        private
        returns (uint256 firstTokenId)
    {
        EventInfo storage ev = _events[eventId];
        _requirePurchasable(ev);

        uint256 unitPrice  = ev.priceWei;
        uint256 totalPrice = unitPrice * quantity;
        require(msg.value >= totalPrice, "Insufficient payment");
        require(ev.ticketsSold + quantity <= ev.maxTickets, "Not enough tickets");
        require(
            ticketsOwnedByBuyer[msg.sender][eventId] + quantity <= ev.maxPerBuyer,
            "Per-buyer cap exceeded"
        );

        firstTokenId = _tokenIdCounter + 1;
        for (uint256 i = 0; i < quantity; ) {
            uint256 mintedId = _mintTicket(ev, eventId, msg.sender);
            emit TicketMinted(mintedId, eventId, msg.sender, unitPrice);
            unchecked { ++i; }
        }

        if (totalPrice > 0) {
            (bool ok, ) = payable(ev.organiser).call{value: totalPrice}("");
            require(ok, "Organiser transfer failed");
        }
        uint256 excess = msg.value - totalPrice;
        if (excess > 0) {
            (bool refundOk, ) = payable(msg.sender).call{value: excess}("");
            require(refundOk, "Refund failed");
        }
    }

    // =====================================================================
    //                       RESALE MARKETPLACE
    // =====================================================================

    /**
     * @notice Lists a ticket the caller owns on the internal resale market.
     * @param  tokenId   Ticket id to list.
     * @param  price     Resale price in wei (must be > 0).
     * @param  expiresAt Unix timestamp after which the listing auto-expires;
     *                   pass 0 to disable expiry.
     */
    function listForResale(uint256 tokenId, uint256 price, uint256 expiresAt) external {
        require(price > 0, "Price must be > 0");
        require(ownerOf(tokenId) == msg.sender, "Not ticket owner");
        require(ticketValid[tokenId], "Ticket invalidated");
        require(!_resale[tokenId].active, "Already listed");

        uint256 eventId = tokenToEvent[tokenId];
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(block.timestamp < ev.date, "Event already finished");

        if (expiresAt != 0) {
            require(expiresAt > block.timestamp, "expiresAt in the past");
            require(expiresAt <= ev.date, "expiresAt after event date");
        }

        _resale[tokenId] = ResaleListing({
            seller:    msg.sender,
            price:     price,
            expiresAt: expiresAt,
            active:    true
        });
        _addActiveListing(tokenId);

        emit TicketListedForResale(tokenId, msg.sender, price, expiresAt);
    }

    /**
     * @notice Cancels an active resale listing. Only the seller may cancel.
     * @param  tokenId Ticket id whose listing to cancel.
     */
    function cancelResaleListing(uint256 tokenId) external {
        ResaleListing storage listing = _resale[tokenId];
        require(listing.active, "Listing not active");
        require(listing.seller == msg.sender, "Not the seller");

        listing.active = false;
        _removeActiveListing(tokenId);
        emit ResaleListingCancelled(tokenId, msg.sender);
    }

    /**
     * @notice Purchases a ticket from the resale marketplace. The sale price
     *         is split: royaltyBps goes to the event organiser; the remainder
     *         goes to the seller. Excess ETH sent by the buyer is refunded.
     * @dev    Reentrancy-guarded because ETH flows outward to three parties.
     *         Uses checks-effects-interactions: state is finalised before
     *         any external call.
     * @param  tokenId Ticket id to purchase.
     */
    function buyResaleTicket(uint256 tokenId) external payable nonReentrant {
        ResaleListing storage listing = _resale[tokenId];
        require(listing.active, "Listing not active");
        require(
            listing.expiresAt == 0 || block.timestamp <= listing.expiresAt,
            "Listing expired"
        );
        require(msg.value >= listing.price, "Insufficient payment");
        require(ticketValid[tokenId], "Ticket invalidated");

        uint256 eventId = tokenToEvent[tokenId];
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(block.timestamp < ev.date, "Event already finished");

        address seller = listing.seller;
        require(seller != msg.sender, "Cannot buy own listing");
        require(ownerOf(tokenId) == seller, "Seller no longer owner");

        uint256 salePrice    = listing.price;
        uint256 royaltyAmt   = (salePrice * ev.royaltyBps) / 10_000;
        uint256 sellerAmt    = salePrice - royaltyAmt;
        address organiser    = ev.organiser;

        // Effects (finalise state before any ETH leaves the contract).
        listing.active = false;
        _removeActiveListing(tokenId);
        _transfer(seller, msg.sender, tokenId);

        // Interactions.
        if (sellerAmt > 0) {
            (bool sOk, ) = payable(seller).call{value: sellerAmt}("");
            require(sOk, "Seller transfer failed");
        }
        if (royaltyAmt > 0) {
            (bool rOk, ) = payable(organiser).call{value: royaltyAmt}("");
            require(rOk, "Royalty transfer failed");
        }
        uint256 excess = msg.value - salePrice;
        if (excess > 0) {
            (bool refOk, ) = payable(msg.sender).call{value: excess}("");
            require(refOk, "Refund failed");
        }

        emit TicketResold(tokenId, seller, msg.sender, salePrice, royaltyAmt);
    }

    // =====================================================================
    //                             VIEWS
    // =====================================================================

    /**
     * @notice EIP-2981 implementation: returns the royalty recipient and amount
     *         owed on a sale of `tokenId` at `salePrice`.
     * @dev    `royaltyBps` is in basis points (10_000 == 100 %). For a sale
     *         price of `S` with `B` bps, the royalty owed is `(S * B) / 10_000`.
     *         EIP-2981 is advisory — external marketplaces may ignore it. The
     *         internal `buyResaleTicket` path enforces the split on-chain, so
     *         any sale routed through this contract cannot skip the royalty.
     * @param  tokenId    The ticket token id.
     * @param  salePrice  The sale price (wei) to compute royalty against.
     * @return receiver       Address that should receive the royalty.
     * @return royaltyAmount  Amount of wei owed as royalty.
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        uint256 eventId = tokenToEvent[tokenId];
        EventInfo storage ev = _events[eventId];
        receiver = ev.organiser;
        royaltyAmount = (salePrice * ev.royaltyBps) / 10_000;
    }

    /// @notice Returns full event information by id.
    function getEvent(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (EventInfo memory)
    {
        return _events[eventId];
    }

    /// @notice Returns total number of events created.
    function getEventCount() external view returns (uint256) {
        return _eventIdCounter;
    }

    /// @notice Returns total number of tickets ever minted.
    function getTokenCount() external view returns (uint256) {
        return _tokenIdCounter;
    }

    /// @notice Returns the resale listing for a given tokenId (may be inactive).
    function getResaleListing(uint256 tokenId) external view returns (ResaleListing memory) {
        return _resale[tokenId];
    }

    /// @notice Returns all currently-active resale listing tokenIds.
    function getActiveListings() external view returns (uint256[] memory) {
        return _activeListings;
    }

    /**
     * @notice Returns all ticket ids currently owned by `user`.
     * @dev    O(total-minted); suitable for frontends, avoid calling on-chain.
     */
    function getTicketsOfUser(address user) external view returns (uint256[] memory) {
        uint256 totalMinted = _tokenIdCounter;
        uint256 count;
        for (uint256 i = 1; i <= totalMinted; ) {
            if (_ownerOfSafe(i) == user) { unchecked { ++count; } }
            unchecked { ++i; }
        }
        uint256[] memory ids = new uint256[](count);
        uint256 idx;
        for (uint256 i = 1; i <= totalMinted; ) {
            if (_ownerOfSafe(i) == user) {
                ids[idx] = i;
                unchecked { ++idx; }
            }
            unchecked { ++i; }
        }
        return ids;
    }

    /// @notice Returns the event associated with `tokenId`.
    function getEventOfToken(uint256 tokenId) external view returns (EventInfo memory) {
        require(_ownerOfSafe(tokenId) != address(0), "Token does not exist");
        return _events[tokenToEvent[tokenId]];
    }

    /// @notice Whether a ticket is still valid (not invalidated at venue).
    function isTicketValid(uint256 tokenId) external view returns (bool) {
        return ticketValid[tokenId];
    }

    /// @notice Number of tickets `user` has bought for `eventId`.
    function ticketsBoughtBy(address user, uint256 eventId)
        external
        view
        returns (uint256)
    {
        return ticketsOwnedByBuyer[user][eventId];
    }

    // ---------------------------------------------------------------------
    // ERC165 / Interface support
    // ---------------------------------------------------------------------

    /// @inheritdoc ERC721URIStorage
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC2981).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // =====================================================================
    //                         INTERNAL HELPERS
    // =====================================================================

    /// @dev Shared purchasability check for primary sales.
    function _requirePurchasable(EventInfo storage ev) private view {
        require(!ev.cancelled, "Event cancelled");
        require(block.timestamp < ev.date, "Event already finished");
        require(ev.ticketsSold < ev.maxTickets, "Event sold out");
    }

    /// @dev Mints one ticket to `buyer` for `ev`/`eventId`; handles all
    ///      counters and sets an IPFS-derived tokenURI.
    function _mintTicket(EventInfo storage ev, uint256 eventId, address buyer)
        private
        returns (uint256 tokenId)
    {
        tokenId = _tokenIdCounter + 1;
        unchecked {
            _tokenIdCounter = tokenId;
            ev.ticketsSold += 1;
            ticketsOwnedByBuyer[buyer][eventId] += 1;
        }
        tokenToEvent[tokenId] = eventId;
        ticketValid[tokenId]  = true;

        _safeMint(buyer, tokenId);

        // tokenURI = "<eventMetadataURI>/<tokenId>.json" — keeps content off-chain.
        _setTokenURI(
            tokenId,
            string(abi.encodePacked(ev.metadataURI, "/", _toString(tokenId), ".json"))
        );
    }

    /// @dev Adds a tokenId to the active-listings enumerable list.
    function _addActiveListing(uint256 tokenId) private {
        _activeListings.push(tokenId);
        _activeListingIndex[tokenId] = _activeListings.length; // stored as idx+1
    }

    /// @dev Removes a tokenId from the active-listings list in O(1).
    function _removeActiveListing(uint256 tokenId) private {
        uint256 idxPlusOne = _activeListingIndex[tokenId];
        if (idxPlusOne == 0) return;
        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = _activeListings.length - 1;
        if (idx != lastIdx) {
            uint256 lastTokenId = _activeListings[lastIdx];
            _activeListings[idx] = lastTokenId;
            _activeListingIndex[lastTokenId] = idx + 1;
        }
        _activeListings.pop();
        delete _activeListingIndex[tokenId];
    }

    /// @dev If a listing exists & is active, cancel it silently (for invalidation).
    function _removeListingIfActive(uint256 tokenId) private {
        ResaleListing storage listing = _resale[tokenId];
        if (listing.active) {
            listing.active = false;
            _removeActiveListing(tokenId);
            emit ResaleListingCancelled(tokenId, listing.seller);
        }
    }

    /// @dev Safe ownerOf that returns address(0) for non-existent ids instead
    ///      of reverting; used by view helpers.
    function _ownerOfSafe(uint256 tokenId) private view returns (address) {
        return _ownerOf(tokenId);
    }

    /// @dev uint256 → decimal string (minimal, no external lib).
    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { unchecked { ++digits; } temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked { --digits; }
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
