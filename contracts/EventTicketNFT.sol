// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  EventTicketNFT
 * @author CS 218 — Team Minimalists
 * @notice NFT-based event ticketing system implementing ERC-721 ownership and
 *         ERC-2981 on-chain royalties. Events are divided into one or more
 *         sections (e.g. "VIP", "Regular", "Economy") — each section carries
 *         its own price and supply of tickets. Buyers choose the section
 *         they want at purchase time. Includes an internal resale
 *         marketplace with royalty-deducting settlement, anti-scalping
 *         per-buyer caps, organiser check-in (invalidation), batch buying,
 *         and IPFS metadata.
 * @dev    All monetary amounts are in wei. Royalty is expressed in basis points
 *         (10_000 == 100%). Full NatSpec on every public/external function.
 *
 *         Storage layout is deliberately minimal — EVERY human-readable
 *         string (event name, description, category, section labels,
 *         banner image, etc.) lives off-chain in an IPFS-hosted JSON
 *         document whose CID is stored as `metadataURI`. The contract
 *         requires this URI to be non-empty but treats its contents as
 *         opaque. Because IPFS CIDs are content-addressed, the document
 *         cannot change without invalidating the CID already on chain,
 *         so integrity is preserved without paying SSTORE gas for every
 *         character.
 *
 *         Expected IPFS JSON shape (organiser tooling builds it):
 *             {
 *               "name": string,
 *               "description": string,
 *               "category": string,
 *               "image": "ipfs://...",
 *               "attributes": [ { trait_type, value }, ... ],
 *               "sections": [ { "name": string }, ... ]
 *             }
 *
 *         Top-level `EventInfo.priceWei` / `maxTickets` / `ticketsSold` are
 *         maintained as aggregates over the event's sections:
 *           - priceWei    = cheapest section's price (for "from X ETH" UI)
 *           - maxTickets  = sum of every section's supply cap
 *           - ticketsSold = sum of every section's running minted counter
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

    /// @notice Hard upper bound on the number of sections per event so a
    ///         misbehaving organiser can't blow up gas with thousands of
    ///         tiny sections.
    uint256 public constant MAX_SECTIONS_PER_EVENT = 20;

    /// @notice Hard upper bound on resale price, expressed as a multiplier
    ///         of the original (primary-sale) section price the ticket was
    ///         minted at. Sellers may NEVER list a ticket above
    ///         `MAX_RESALE_PRICE_MULTIPLIER × originalSectionPrice`. This
    ///         is the protocol-level anti-scalping rail (paired with the
    ///         per-buyer cap on primary sales). Free tickets
    ///         (originalPrice == 0) bypass this cap because 0 × N == 0
    ///         would otherwise make them un-resellable.
    uint256 public constant MAX_RESALE_PRICE_MULTIPLIER = 2;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice On-chain record for a single event. Human-readable strings
    ///         (name, description, category, etc.) are NOT stored here —
    ///         they live inside the JSON document referenced by
    ///         `metadataURI`. Keeping the struct tight saves substantial
    ///         gas on event creation.
    struct EventInfo {
        string  metadataURI;   // IPFS URI to JSON with name/description/category/image/section labels (REQUIRED)
        uint256 date;          // Unix timestamp; tickets cannot be bought past this
        uint256 priceWei;      // Cheapest section's price (aggregate, display-only)
        uint256 maxTickets;    // Hard supply cap (aggregate of all sections)
        uint256 ticketsSold;   // Running counter (aggregate of all sections)
        uint96  royaltyBps;    // EIP-2981 royalty (basis points)
        uint32  maxPerBuyer;   // Per-address purchase cap for this event (across sections)
        address organiser;     // Address that receives primary sale revenue + royalties
        bool    cancelled;     // If true, event cannot be purchased or resold
    }

    /// @notice A single division / seating tier on an event. Display label
    ///         (e.g. "VIP", "Regular") lives off-chain in the metadata JSON
    ///         under `sections[sectionId].name`.
    struct Section {
        uint256 priceWei;      // Primary-sale price in wei for this section
        uint256 maxTickets;    // Supply cap for this section
        uint256 ticketsSold;   // Running counter for this section
    }

    /// @notice Input used when creating an event — mirrors `Section` without
    ///         the `ticketsSold` counter (always starts at 0).
    struct SectionInput {
        uint256 priceWei;
        uint256 maxTickets;
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

    /// @notice eventId → Section[] (one entry per division)
    mapping(uint256 => Section[]) private _sections;

    /// @notice tokenId → eventId it belongs to
    mapping(uint256 => uint256) public tokenToEvent;

    /// @notice tokenId → sectionId within that event
    mapping(uint256 => uint256) public tokenToSection;

    /// @notice tokenId → is ticket still valid (organiser can invalidate on entry)
    mapping(uint256 => bool) public ticketValid;

    /// @notice tokenId → resale listing
    mapping(uint256 => ResaleListing) private _resale;

    /// @notice (buyer,eventId) → tickets purchased — anti-scalping accounting
    mapping(address => mapping(uint256 => uint256)) public ticketsOwnedByBuyer;

    /// @notice tokenId → event date, used for resale validity checks.
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
        string  metadataURI,
        uint256 date,
        uint256 sectionCount,
        uint256 maxTickets,
        uint96  royaltyBps
    );

    event SectionCreated(
        uint256 indexed eventId,
        uint256 indexed sectionId,
        uint256 priceWei,
        uint256 maxTickets
    );

    event TicketMinted(
        uint256 indexed tokenId,
        uint256 indexed eventId,
        uint256 indexed sectionId,
        address buyer,
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

    event TicketsAddedToSection(
        uint256 indexed eventId,
        uint256 indexed sectionId,
        uint256 addedAmount,
        uint256 newSectionTotal,
        uint256 newEventTotal
    );

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
     * @notice Creates a new event divided into one or more sections. Any
     *         address can call; the caller becomes the organiser for that
     *         event and will receive primary-sale revenue plus EIP-2981
     *         royalties from resales.
     * @dev    All display text (name, description, category, banner image,
     *         per-section labels) must be uploaded to IPFS first; only the
     *         resulting `metadataURI` is stored on chain. At least one
     *         section is required.
     * @param  metadataURI  IPFS URI (e.g. "ipfs://<CID>") to the event's
     *                      metadata JSON. Must be non-empty.
     * @param  date         Unix timestamp of the event; must be > now + 1 day.
     * @param  royaltyBps   EIP-2981 royalty share in basis points (≤ MAX_ROYALTY_BPS).
     * @param  maxPerBuyer  Per-address purchase cap across all sections.
     * @param  sections     Array of sections (priceWei/maxTickets each).
     * @return eventId      The numeric id assigned to the newly created event.
     */
    function createEvent(
        string calldata metadataURI,
        uint256 date,
        uint96  royaltyBps,
        uint32  maxPerBuyer,
        SectionInput[] calldata sections
    ) external returns (uint256 eventId) {
        require(bytes(metadataURI).length != 0, "metadataURI required");
        // Enforce at least a 24h lead-time so buyers have a chance to react and
        // to prevent "create-and-drain" flash events.
        require(date > block.timestamp + 1 days, "Event must be at least 1 day in the future");
        require(royaltyBps <= MAX_ROYALTY_BPS, "Royalty exceeds cap");
        require(maxPerBuyer > 0, "maxPerBuyer must be > 0");
        // Hard-fail instead of silently clamping: the organiser should know
        // exactly what cap is applied to their event.
        require(maxPerBuyer <= GLOBAL_MAX_PER_BUYER, "maxPerBuyer exceeds global cap");
        require(sections.length > 0, "At least one section required");
        require(sections.length <= MAX_SECTIONS_PER_EVENT, "Too many sections");

        eventId = _eventIdCounter;
        // Safe: uint256 cannot realistically overflow from this increment.
        unchecked { _eventIdCounter = eventId + 1; }

        uint256 totalMax;
        uint256 minPrice = type(uint256).max;
        Section[] storage secArr = _sections[eventId];

        for (uint256 i = 0; i < sections.length; ) {
            SectionInput calldata s = sections[i];
            require(s.maxTickets > 0, "Section maxTickets must be > 0");

            secArr.push(Section({
                priceWei:    s.priceWei,
                maxTickets:  s.maxTickets,
                ticketsSold: 0
            }));

            emit SectionCreated(eventId, i, s.priceWei, s.maxTickets);

            totalMax += s.maxTickets;
            if (s.priceWei < minPrice) minPrice = s.priceWei;
            unchecked { ++i; }
        }

        _events[eventId] = EventInfo({
            metadataURI:  metadataURI,
            date:         date,
            priceWei:     minPrice,
            maxTickets:   totalMax,
            ticketsSold:  0,
            royaltyBps:   royaltyBps,
            maxPerBuyer:  maxPerBuyer,
            organiser:    msg.sender,
            cancelled:    false
        });

        emit EventCreated(
            eventId,
            msg.sender,
            metadataURI,
            date,
            sections.length,
            totalMax,
            royaltyBps
        );
    }

    /**
     * @notice Updates the editable event-level fields (metadata URI, date,
     *         royalty, per-buyer cap). Section prices and supplies are
     *         managed separately via `addTicketsToSection` and are not
     *         touched here. To rename the event or edit its description,
     *         upload a new metadata JSON to IPFS and pass the new CID.
     * @dev    Safety rules:
     *          - `metadataURI` / `date` / `maxPerBuyer` are always editable
     *            (while the event is live and uncancelled).
     *          - `royaltyBps` may ONLY be changed while no ticket has been
     *            sold, otherwise we'd rewrite terms on existing holders
     *            mid-event (unfair and a griefing vector).
     *          - The organiser address is intentionally immutable — see the
     *            royalty design in `royaltyInfo`.
     */
    function updateEvent(
        uint256 eventId,
        string calldata metadataURI,
        uint256 newDate,
        uint96  newRoyaltyBps,
        uint32  newMaxPerBuyer
    )
        external
        eventExists(eventId)
        onlyOrganiser(eventId)
    {
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(bytes(metadataURI).length != 0, "metadataURI required");
        require(newDate > block.timestamp + 1 days, "Event must be at least 1 day in the future");
        require(newRoyaltyBps <= MAX_ROYALTY_BPS, "Royalty exceeds cap");
        require(newMaxPerBuyer > 0, "maxPerBuyer must be > 0");
        require(newMaxPerBuyer <= GLOBAL_MAX_PER_BUYER, "maxPerBuyer exceeds global cap");

        if (ev.royaltyBps != newRoyaltyBps) {
            require(ev.ticketsSold == 0, "Royalty locked after first sale");
            ev.royaltyBps = newRoyaltyBps;
        }

        ev.metadataURI  = metadataURI;
        ev.date         = newDate;
        ev.maxPerBuyer  = newMaxPerBuyer;

        emit EventUpdated(eventId, msg.sender);
    }

    /**
     * @notice Adds supply to an existing section of an event.
     * @param  eventId   Id of the event to extend.
     * @param  sectionId Index of the section within that event.
     * @param  amount    Additional tickets to mint into that section (> 0).
     */
    function addTicketsToSection(uint256 eventId, uint256 sectionId, uint256 amount)
        external
        eventExists(eventId)
        onlyOrganiser(eventId)
    {
        require(amount > 0, "amount must be > 0");
        EventInfo storage ev = _events[eventId];
        require(!ev.cancelled, "Event cancelled");
        require(block.timestamp < ev.date, "Event already finished");
        require(sectionId < _sections[eventId].length, "Invalid section");

        Section storage sec = _sections[eventId][sectionId];
        sec.maxTickets += amount;
        ev.maxTickets  += amount;

        emit TicketsAddedToSection(eventId, sectionId, amount, sec.maxTickets, ev.maxTickets);
    }

    /**
     * @notice Cancels an event. No further primary sales or resales will be
     *         allowed. Existing ticket holders keep their NFTs but cannot
     *         trade them on the internal marketplace.
     * @dev    IMPORTANT: this does NOT refund past buyers. Primary-sale ETH
     *         is forwarded to the organiser at purchase time, so the contract
     *         holds no funds to refund from.
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
     * @notice Purchases a single ticket for `eventId` from a specific section.
     *         The caller must send at least `section.priceWei`; excess is refunded.
     * @param  eventId   The event to buy a ticket for.
     * @param  sectionId Section (division) to buy from.
     * @return tokenId   The id of the freshly minted ERC-721 ticket.
     */
    function buyTicket(uint256 eventId, uint256 sectionId)
        external
        payable
        nonReentrant
        eventExists(eventId)
        returns (uint256 tokenId)
    {
        tokenId = _buy(eventId, sectionId, 1);
    }

    /**
     * @notice Purchases multiple tickets from the same section in one tx.
     * @param  eventId   The event to buy tickets for.
     * @param  sectionId Section (division) to buy from.
     * @param  quantity  Number of tickets (>= 1).
     * @return firstTokenId Id of the first minted ticket; subsequent tickets
     *                      are sequentially numbered.
     */
    function buyMultipleTickets(uint256 eventId, uint256 sectionId, uint256 quantity)
        external
        payable
        nonReentrant
        eventExists(eventId)
        returns (uint256 firstTokenId)
    {
        require(quantity > 0, "quantity must be > 0");
        firstTokenId = _buy(eventId, sectionId, quantity);
    }

    /**
     * @dev Shared primary-sale path. Not `nonReentrant` itself — the public
     *      entry points carry the guard. Uses checks-effects-interactions.
     */
    function _buy(uint256 eventId, uint256 sectionId, uint256 quantity)
        private
        returns (uint256 firstTokenId)
    {
        EventInfo storage ev = _events[eventId];
        _requirePurchasable(ev);
        require(sectionId < _sections[eventId].length, "Invalid section");

        Section storage sec = _sections[eventId][sectionId];
        uint256 unitPrice  = sec.priceWei;
        uint256 totalPrice = unitPrice * quantity;
        require(msg.value >= totalPrice, "Insufficient payment");
        require(sec.ticketsSold + quantity <= sec.maxTickets, "Not enough tickets in section");
        require(
            ticketsOwnedByBuyer[msg.sender][eventId] + quantity <= ev.maxPerBuyer,
            "Per-buyer cap exceeded"
        );

        firstTokenId = _tokenIdCounter + 1;
        for (uint256 i = 0; i < quantity; ) {
            uint256 mintedId = _mintTicket(ev, eventId, sectionId, msg.sender);
            emit TicketMinted(mintedId, eventId, sectionId, msg.sender, unitPrice);
            unchecked { ++i; }
        }

        // Aggregate counters (effects done before ETH leaves the contract).
        unchecked {
            sec.ticketsSold += quantity;
            ev.ticketsSold  += quantity;
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

        // Anti-scalping rail: cap resale price at 2x the original section
        // price the ticket was minted at. Free tickets (originalPrice == 0)
        // are exempt — otherwise the cap would force the resale price to 0
        uint256 originalPrice = _sections[eventId][tokenToSection[tokenId]].priceWei;
        if (originalPrice > 0) {
            require(
                price <= originalPrice * MAX_RESALE_PRICE_MULTIPLIER,
                "Resale price exceeds 2x original"
            );
        }

        if (expiresAt != 0) {
            require(expiresAt > block.timestamp,"expiresAt in the past");
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
     *         goes to the seller.Excess ETH sent by the buyer is refunded.
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
        uint256 sellerAmt    = salePrice-royaltyAmt;
        address organiser    = ev.organiser;

        // Effects.
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
     * @notice EIP-2981 implementation.
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

    /// @notice Returns every section configured on an event.
    function getSections(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (Section[] memory)
    {
        return _sections[eventId];
    }

    /// @notice Returns a single section by (eventId, sectionId).
    function getSection(uint256 eventId, uint256 sectionId)
        external
        view
        eventExists(eventId)
        returns (Section memory)
    {
        require(sectionId < _sections[eventId].length, "Invalid section");
        return _sections[eventId][sectionId];
    }

    /// @notice Returns Number of sections on an event.
    function getSectionCount(uint256 eventId)
        external
        view
        eventExists(eventId)
        returns (uint256)
    {
        return _sections[eventId].length;
    }

    /// @notice Returns the section a particular ticket belongs to.
    function getSectionOfToken(uint256 tokenId)
        external
        view
        returns (Section memory)
    {
        require(_ownerOfSafe(tokenId) != address(0), "Token does not exist");
        uint256 eventId = tokenToEvent[tokenId];
        uint256 sectionId = tokenToSection[tokenId];
        return _sections[eventId][sectionId];
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

    /**
     * @notice Maximum resale price (in wei) the ticket can be listed at.
     *         Equal to `MAX_RESALE_PRICE_MULTIPLIER × originalSectionPrice`.
     *         Returns `type(uint256).max` for tickets minted at price 0
     *         (free tickets are exempt from the cap).
     * @param  tokenId Ticket id to query the cap for.
     */
    function maxResalePriceFor(uint256 tokenId) external view returns (uint256) {
        require(_ownerOfSafe(tokenId) != address(0), "Token does not exist");
        uint256 eventId   = tokenToEvent[tokenId];
        uint256 sectionId = tokenToSection[tokenId];
        uint256 original  = _sections[eventId][sectionId].priceWei;
        if (original == 0) return type(uint256).max;
        return original * MAX_RESALE_PRICE_MULTIPLIER;
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

    /// @dev Mints one ticket to `buyer` for (`eventId`,`sectionId`). Does NOT
    ///      increment per-section / per-event sold counters — the caller
    ///      (`_buy`) does that in one batched write after the loop.
    function _mintTicket(
        EventInfo storage /*ev*/,
        uint256 eventId,
        uint256 sectionId,
        address buyer
    )
        private
        returns (uint256 tokenId)
    {
        tokenId = _tokenIdCounter + 1;
        unchecked {
            _tokenIdCounter = tokenId;
            ticketsOwnedByBuyer[buyer][eventId] += 1;
        }
        tokenToEvent[tokenId]   = eventId;
        tokenToSection[tokenId] = sectionId;
        ticketValid[tokenId]    = true;

        _safeMint(buyer, tokenId);

        // tokenURI = "<eventMetadataURI>/<tokenId>.json" — keeps content off-chain.
        // Section info is recoverable on-chain via tokenToSection / getSectionOfToken.
        _setTokenURI(
            tokenId,
            string(abi.encodePacked(_events[eventId].metadataURI, "/", _toString(tokenId), ".json"))
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
