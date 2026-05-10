# BookYourShow — NFT Event Ticketing (ERC-721)

> **CS 218 — Programmable & Interoperable Blockchain**
> **Project 7 — NFT Event Ticketing (ERC-721)**
> Submission deadline: **10 May 2026, 11:59 PM**

An end-to-end decentralised event-ticketing platform. Tickets are
ERC-721 NFTs issued by a single Solidity contract; event metadata lives
off-chain on IPFS (Pinata) to keep gas costs low; a React frontend
provides the full buy / resell / check-in experience.

**Team — Team Minimalists**

| Name                     | Roll Number |
| ------------------------ | ----------- |
| S Varshith Reddy         | 240001071   |
| Donthula Manish          | 240001029   |
| Sarath Chandra Jandhyala | 240041020   |
| Gunala Kushal Goud       | 240001033   |
| Harshith Pasupuleti      | 240003034   |
| Srigiri Sairaj           | 240001070   |

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Smart contract highlights](#smart-contract-highlights)
4. [Gas optimisation — off-chain metadata](#gas-optimisation--off-chain-metadata)
5. [Frontend highlights](#frontend-highlights)
6. [Tech stack](#tech-stack)
7. [Repository layout](#repository-layout)
8. [Prerequisites](#prerequisites)
9. [Setup](#setup)
10. [Environment variables](#environment-variables)
11. [IPFS / Pinata setup](#ipfs--pinata-setup)
12. [Running locally](#running-locally)
13. [Deploying to Sepolia](#deploying-to-sepolia)
14. [Testing](#testing)
15. [Organiser check-in flow](#organiser-check-in-flow)
16. [Security & privacy notes](#security--privacy-notes)
17. [Known issues & limitations](#known-issues--limitations)
18. [Scripts reference](#scripts-reference)

---

## What it does

BookYourShow lets organisers sell tickets to events on-chain as NFTs.
Each event can have multiple **sections** (e.g. VIP / Regular / Economy)
with their own price and supply. Buyers can purchase tickets with a
connected wallet, re-sell them on the built-in royalty-aware
marketplace, or redeem them at the venue through an organiser check-in
tool that invalidates the NFT on chain.

### Core features

- **Wallet-first UX** — MetaMask connect / auto-reconnect / network check
- **Sectioned events** — up to 20 sections per event, per-section price & supply
- **Primary sales** — single or batch ticket minting with per-buyer caps
- **Royalty-aware resale marketplace** — EIP-2981 split at settlement
- **Check-in (ticket invalidation)** — organiser invalidates a token at entry
- **Event lifecycle** — create / edit / cancel / add supply to a section
- **Landing page**, search, category & price-range filters, ticket grouping
- **IPFS uploads inside the app** — images + metadata pinned through Pinata
- **Fallback image rendering** — deterministic gradient placeholder if the
  banner fails to load, so event cards never appear empty

---

## Architecture

```
┌─────────────────┐   read-only JSON    ┌────────────────────┐
│  React frontend │ ──────────────────▶ │  IPFS (Pinata)     │
│  (Vite)         │                     │  metadata + images │
│                 │ ◀─────────────────┐ └────────────────────┘
│                 │                   │           ▲
│                 │   tx / reads      │  pin      │ pin
│                 ▼                   │           │
│         ┌──────────────────┐        │   ┌────────────────┐
│         │  EventTicketNFT  │────────┘   │ uploadFile /   │
│         │  ERC-721 + 2981  │            │ uploadJSON API │
│         └──────────────────┘            └────────────────┘
│                 ▲
└─────── ethers.js v6 ───────
```

The contract stores **only** what it needs for logic — IDs, dates,
prices, supplies, royalties, organiser addresses. Every human-readable
string (event name, description, category, section labels, banner
image) is stored in a JSON document pinned to IPFS; the contract keeps
just the `metadataURI` pointing at it. Because IPFS CIDs are
content-addressed (CID = hash of content), this preserves integrity
without paying SSTORE gas for every character.

---

## Smart contract highlights

`contracts/EventTicketNFT.sol` — a single contract implementing:

- **ERC-721** — one NFT per ticket, with `tokenURI` derived from the event's
  metadata CID plus the tokenId (`<metadataURI>/<tokenId>.json`)
- **ERC-2981** — on-chain royalty metadata; royalty is split automatically
  at resale settlement (not left to marketplace goodwill)
- **`ReentrancyGuard`** on every external payable path
- **Checks-effects-interactions** throughout; counters are updated before
  any ETH leaves the contract
- **Section-based supply** — each event has 1–20 sections, each with its
  own price/supply; aggregate counters are maintained on the parent event
- **Anti-scalping**
  - Per-event `maxPerBuyer` cap (hard-bounded by `GLOBAL_MAX_PER_BUYER = 10`)
  - Counter-cheating-proof: buyer quota is enforced across sections
  - **Resale price cap** — `MAX_RESALE_PRICE_MULTIPLIER = 2`. A ticket
    can never be re-listed for more than **2× its original primary-sale
    price**. Enforced on-chain in `listForResale` (revert
    `"Resale price exceeds 2x original"`) and validated client-side in
    `TicketCard.jsx` before the wallet round-trip.
- **Creation safety rails**
  - **`createEvent` is `onlyOwner`** — the contract deployer is the
    organiser, so event creation is restricted to that single address
    (OpenZeppelin `Ownable`)
  - Event date must be ≥ 24 h in the future
  - Royalty capped at `MAX_ROYALTY_BPS = 5_000` (50 %)
  - Royalty is **locked** once the first ticket sells (can't rewrite terms
    on existing holders)
- **Marketplace**
  - Listings can optionally expire; expiry must be before the event date
  - Cancel-own-listing, buy-own-listing protection
  - O(1) active-listings enumeration for cheap frontend reads
- **Organiser admin**
  - `updateEvent` for editable fields (metadata URI, date, maxPerBuyer,
    royalty while allowed)
  - `addTicketsToSection` to extend supply (not reduce it)
  - `cancelEvent` blocks further sales and resales
  - `invalidateTicket` (check-in): only organiser or contract owner,
    silently cancels any active resale listing on the same token

### Public API summary

```solidity
createEvent(
  string metadataURI,     // ipfs://<cid> — REQUIRED
  uint256 date,
  uint96  royaltyBps,
  uint32  maxPerBuyer,
  SectionInput[] sections // { priceWei, maxTickets }
) returns (uint256 eventId)

updateEvent(uint256 eventId, string metadataURI, uint256 newDate, uint96 newRoyaltyBps, uint32 newMaxPerBuyer)

buyTicket(uint256 eventId, uint256 sectionId) payable returns (uint256 tokenId)
buyMultipleTickets(uint256 eventId, uint256 sectionId, uint256 quantity) payable

listForResale(uint256 tokenId, uint256 price, uint256 expiresAt)
cancelResaleListing(uint256 tokenId)
buyResaleTicket(uint256 tokenId) payable

addTicketsToSection(uint256 eventId, uint256 sectionId, uint256 amount)
cancelEvent(uint256 eventId)
invalidateTicket(uint256 tokenId)

// Views
getEvent, getSections, getSection, getSectionCount,
getEventCount, getTokenCount,
getActiveListings, getResaleListing,
getTicketsOfUser, getEventOfToken, getSectionOfToken,
isTicketValid, ticketsBoughtBy, royaltyInfo
```

---

## Gas optimisation — off-chain metadata

The struct used to store every event's display text on chain
(`name`, `category`, `description`, and each section's `name`). That
meant paying ~20 000 gas **per 32-byte slot** for every string. In the
current design those strings live entirely in the IPFS metadata
document; only the CID is on chain.

### What stays on chain

| Field                                           | Why it stays                                        |
| ----------------------------------------------- | --------------------------------------------------- |
| `metadataURI`                                   | Anchors the metadata document (required, non-empty) |
| `date`                                          | Needed for purchase window / expiry / resale checks |
| `priceWei` (aggregate)                          | Needed for "from X ETH" UI                          |
| `maxTickets`, `ticketsSold`                     | Inventory enforcement                               |
| `royaltyBps`                                    | Settlement split at resale                          |
| `maxPerBuyer`                                   | Anti-scalping enforcement                           |
| `organiser`                                     | Revenue recipient; immutable by design              |
| `cancelled`                                     | Blocks further sales/resales                        |
| Section `priceWei`, `maxTickets`, `ticketsSold` | All used by `_buy`                                  |

### What moved off-chain

| Field               | Now lives in                         |
| ------------------- | ------------------------------------ |
| `event.name`        | `metadata.name`                      |
| `event.description` | `metadata.description`               |
| `event.category`    | `metadata.category`                  |
| `event.image`       | `metadata.image` (own `ipfs://` CID) |
| `section.name`      | `metadata.sections[i].name`          |

### IPFS JSON schema

```json
{
  "name": "Indie  Night Live",
  "description": "An intimate evening of local indie bands ...",
  "category": "Music",
  "image": "ipfs://<imageCid>",
  "attributes": [
    { "trait_type": "Category", "value": "Music" },
    { "trait_type": "Sections", "value": 2 }
  ],
  "sections": [{ "name": "Front Row" }, { "name": "Standing" }]
}
```

### Before / after — measured with `hardhat-gas-reporter`

The same functional test suite was run against the **on-chain-strings**
schema and again against the current **IPFS-CID** schema with identical
compiler settings (`solc 0.8.28`, `optimizer.runs = 200`, `viaIR = true`).

| `createEvent` | Before (on-chain strings) | After (IPFS pointer) | Saved | Δ |
| ------------- | ------------------------: | -------------------: | ----: | ----: |
| Min           |                   313,285 |              240,951 | **72,334**  | **−23.1 %** |
| Max           |                   480,147 |              357,606 | **122,541** | **−25.5 %** |
| **Avg**       |               **389,440** |          **296,739** | **92,701**  | **−23.8 %** |

| `updateEvent` | Before    | After     | Saved      | Δ        |
| ------------- | --------: | --------: | ---------: | -------: |
| Min           |    49,682 |    39,230 |     10,452 | −21.0 %  |
| Max           |    54,789 |    47,185 |      7,604 | −13.9 %  |
| **Avg**       | **53,087**| **44,533**| **8,554**  | **−16.1 %** |

**Why it works.** Every fresh storage slot costs **20,000 gas**
(`SSTORE` cold). A 200-character description previously needed 1
length-slot + 7 data-slots = **~160,000 gas** of cold SSTORE on every
event creation. We removed those slots entirely and added back a single
~60-char IPFS CID (~3 slots). Integrity is preserved because the CID is
the keccak-style content hash of the JSON — the document cannot change
without invalidating the CID already on chain.

Raw tool output is in [`reports/gas-report.pdf`](./reports/gas-report.pdf);
the deeper write-up (slot accounting + the seven other smaller
optimisations applied on top) is in
[`reports/project-evaluation.md`](./reports/project-evaluation.md#§d-gas-optimisation--3-marks-deep-dive).

---

## Frontend highlights

- **React 19 + Vite 8**, a single SPA with React Router
- **Hand-rolled design system** in `src/index.css` — editorial serif
  headings, neutral surface palette, consistent spacing & components
- **BookYourShow brand** — ticket+play gradient favicon used as both
  browser icon and in-app navbar mark (vector, renders crisply at any
  size)
- **Landing page** with app description and navigation
- **Events listing, Marketplace, My Tickets** all support
  - Full-text search
  - Category filter and price-range filter
  - **Grouping** by event + tier (shows VIP / Regular / Economy
    breakdowns with aggregated counts and prices)
- **IPFS integration inside the app**
  - Pinata (JWT) is preferred;falls back to a local Kubo daemon on
    port 5001 if configured
  - `CreateEvent` uploads image→uploads metadata JSON → stores only
    the resulting CID on chain
  - `EditEvent` re-pins a new JSON(carrying forward image + section
    labels) and updates just the URI
- **Pinata-aware gateway ordering** (`src/utils/ipfs.js`)
  - If a Pinata JWT is set, the app fetches from Pinata's gateway
    **first** (dedicated subdomain if provided, otherwise shared
    `gateway.pinata.cloud`)
  - Local Kubo gateways are **never** tried when Pinata is the pinning
    backend — that node doesn't have the CIDs and probing it just
    stalls the UI
  - Multiple public gateways are used as eventual-consistency fallbacks
- **Fallback banners** — `EventCard` / `EventPoster` render a
  deterministic gradient placeholder based on event name & category when
  no image is available, so cards never look empty
- **Metadata cache** — shared `Map` de-dupes fetches across components
  (all instances of the same event request one HTTP call)
- **Currency display** — ETH prices shown alongside live INR conversion
- **Sensitive-data hygiene** — wallet addresses, private keys, and
  contract addresses are **never** rendered to the UI. The only ID that
  is surfaced is the user's own **Token ID** on their ticket card, with
  a copy button, because they need to show it at check-in.

---

## Tech stack

| Layer        | Choices                                                                              |
| ------------ | ------------------------------------------------------------------------------------ |
| Contract     | Solidity 0.8.28, OpenZeppelin v5 (ERC-721, ERC-2981, ReentrancyGuard, Ownable)       |
| Build / test | Hardhat 2 + `hardhat-toolbox`, Mocha + Chai, ethers.js v6                            |
| Frontend     | React 19, Vite 8, React Router 7, ethers.js v6                                       |
| Wallet       | MetaMask (injected EIP-1193 provider)                                                |
| Storage      | IPFS via Pinata (pinFileToIPFS / pinJSONToIPFS), public/dedicated gateways for reads |
| Styling      | Plain CSS variables + small utility set (no CSS-in-JS)                               |

---

## Repository layout

```
.
├── contracts/
│   └── EventTicketNFT.sol           # single-contract design, full NatSpec
├── scripts/
│   └── deploy.js                     # deploys + seeds demo events + writes ABI
├── test/
│   └── EventTicketNFT.test.js        # 68 unit tests, fixture-based
├── hardhat.config.ts                 # solc + Sepolia config
├── package.json                      # hardhat tooling
├── frontend/
│   ├── public/
│   │   ├── favicon.svg               # brand mark (also used in navbar)
│   │   └── icons.svg
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Landing.jsx
│   │   │   ├── Events.jsx            # list + search + filter + grouping
│   │   │   ├── EventDetails.jsx      # event page + buy flow
│   │   │   ├── CreateEvent.jsx       # organiser create + IPFS upload
│   │   │   ├── EditEvent.jsx         # organiser edit + repin JSON
│   │   │   ├── Marketplace.jsx       # resale listings
│   │   │   ├── MyTickets.jsx         # tickets owned/listed by user
│   │   │   └── Organiser.jsx         # dashboard + check-in tool
│   │   ├── components/
│   │   │   ├── Navbar.jsx
│   │   │   ├── EventCard.jsx         # banner + fallback placeholder
│   │   │   ├── ListingCard.jsx
│   │   │   ├── TicketCard.jsx        # shows Token ID for check-in
│   │   │   └── Toast.jsx
│   │   ├── hooks/
│   │   │   ├── useWallet.js
│   │   │   ├── useContract.js        # read/write wrapper, gas-buffer
│   │   │   ├── useEvents.js          # hydrates on-chain events with IPFS JSON
│   │   │   ├── useIpfsMetadata.js    # cached metadata fetcher
│   │   │   └── useCurrency.jsx       # ETH ↔ INR
│   │   ├── utils/
│   │   │   ├── contract.js           # generated ABI + address
│   │   │   ├── ipfs.js               # gateway selection + URI → HTTP
│   │   │   ├── ipfsUpload.js         # Pinata JWT + Kubo fallback
│   │   │   └── helpers.js
│   │   ├── App.jsx
│   │   └── index.css                 # full design system
│   ├── vite.config.js
│   ├── index.html
│   └── package.json
└── README.md
```

---

## Prerequisites

- **Node.js 18+** (project has been tested on Node 20/23)
- **MetaMask** (or any EIP-1193 wallet) in the browser
- **Pinata account** with a JWT for IPFS pinning (free tier is enough).
  Local Kubo is optional; see [IPFS / Pinata setup](#ipfs--pinata-setup).

---

## Setup

```bash
# 1. Clone and install contract tooling
git clone <repo>
cd NFT-Event-Ticketing-ERC-721
npm install

# 2. Install the frontend
cd frontend
npm install
cd ..
```

---

## Environment variables

### Root `.env` (for Hardhat / Sepolia deploys)

```bash
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<your-key>     # or Alchemy
PRIVATE_KEY=0x<deployer-private-key>                         # funded on Sepolia
REPORT_GAS=false                                             # true to enable hardhat-gas-reporter
```

> `PRIVATE_KEY` is only used by the deploy script. Never commit `.env`.

### `frontend/.env.local` (Vite reads this at startup)

```bash
# Required for IPFS uploads from the app (CreateEvent / EditEvent)
VITE_PINATA_JWT=<your pinata jwt>

# Optional: a dedicated Pinata gateway subdomain (higher rate limits,
# faster than the shared gateway.pinata.cloud). Example:
#   VITE_PINATA_GATEWAY=https://bookyourshow.mypinata.cloud/ipfs/
VITE_PINATA_GATEWAY=

# Optional: local Kubo HTTP gateway. ONLY used when VITE_PINATA_JWT is
# NOT set (i.e. you're pinning to a local daemon instead of Pinata).
# VITE_IPFS_GATEWAY=http://127.0.0.1:8080/ipfs/

# Optional: Kubo daemon API endpoint for the local-upload fallback path
# (default http://127.0.0.1:5001). Only used if VITE_PINATA_JWT is empty.
# VITE_IPFS_API=http://127.0.0.1:5001
```

---

## IPFS / Pinata setup

The app supports two upload backends, chosen automatically:

1. **Pinata (preferred)** — set `VITE_PINATA_JWT` in
   `frontend/.env.local`. Uploads go to Pinata's cloud cluster, which
   means the content is instantly available from Pinata's gateway. No
   local daemon required.
2. **Local Kubo (optional)** — if no JWT is configured, uploads go to
   `http://127.0.0.1:5001/api/v0/add` (configurable via
   `VITE_IPFS_API`). Requires `ipfs daemon` to be running and CORS
   configured for the dev server origin:

### Dedicated Pinata gateway (recommended)

In the Pinata dashboard go to **IPFS → Gateways → Create Gateway** and
pick a subdomain (e.g. `bookyourshow` → `bookyourshow.mypinata.cloud`).
Put it in `.env.local` as:

```
VITE_PINATA_GATEWAY=https://bookyourshow.mypinata.cloud/ipfs/
```

Dedicated gateways are faster and rate-limited far more generously than
the shared `gateway.pinata.cloud`.

---

## Running locally

```bash
# Terminal 1 — a local EVM node
npx hardhat node

# Terminal 2 — compile, deploy, seed demo events, write ABI for the frontend
npm run deploy:local

# Terminal 3 — start the frontend dev server
cd frontend
npm run dev
```

The deploy script (`scripts/deploy.js`):

1. Compiles and deploys `EventTicketNFT`
2. Seeds 3 demo events (Music / Conference / Theatre) — each event's
   metadata is inlined as a base64 **data: URI** so the banners render
   instantly without any IPFS round-trip on the local dev chain
3. Writes `frontend/src/utils/contract.js` with the deployed address,
   chain ID, network name, and the fresh ABI

Open the frontend at `http://localhost:5173`. Connect a MetaMask
account, make sure MetaMask is on the correct network (the page will
prompt to switch if not), and you're ready.

---

## Deploying to Sepolia

1. Fund the `PRIVATE_KEY` account with a bit of Sepolia ETH
   (e.g. from a Sepolia faucet).
2. Make sure `.env` has `SEPOLIA_RPC_URL` and `PRIVATE_KEY`.
3. Run:

```bash
 npm run deploy:sepolia
```

4. The script redeploys, seeds the same demo events, and rewrites the
   frontend `contract.js` with the Sepolia address + `chainId: 11155111`.
5. Restart `npm run dev` in the frontend so it picks up the new ABI.

---

## Testing

```bash
npx hardhat test                   # 68 passing, 0 failing  (~3 s)
REPORT_GAS=true npx hardhat test   # also prints gas usage per method
npx hardhat coverage               # solidity-coverage — 99.10% lines, 100% functions
```

The test suite (`test/EventTicketNFT.test.js`) covers:

- Deployment / ERC-721 / ERC-2981 interface support
- `createEvent` success paths + every revert branch (metadata required,
  date too early, royalty cap, no sections, zero-supply section, etc.)
  + **non-owner reject** (asserting OZ `OwnableUnauthorizedAccount`)
- Multi-section behaviour (cheapest-price aggregation, aggregate supply)
- `buyTicket` / `buyMultipleTickets` — mints, payment flow, overpay
  refund, per-section sell-out, per-buyer cap across sections, event
  cancelled, event finished
- Resale listing + cancel + buyback, including
  - 90/10 royalty split asserted against real balance deltas
  - **Cancelled listing cannot be purchased** (revert `"Listing not active"`)
  - **Auto-cancelled listing after `invalidateTicket` cannot be purchased**
  - **Resale price > 2× original primary price reverts**
- `updateEvent` (including royalty lock after first sale, empty-URI
  reject, non-organiser reject)
- Organiser admin — `addTicketsToSection`, `cancelEvent`,
  `invalidateTicket` (also silently cancels any active listing)
- View helpers — `getTicketsOfUser`, `ticketsBoughtBy`,
  `getActiveListings` addition/removal,
  `maxResalePriceFor`, `MAX_RESALE_PRICE_MULTIPLIER`

Pre-captured artefacts the grader can inspect without re-running anything:

- [`reports/coverage-report.pdf`](./reports/coverage-report.pdf) — full
  raw `solidity-coverage` output (every passing test + Istanbul summary)
- [`reports/gas-report.pdf`](./reports/gas-report.pdf) — full
  `hardhat-gas-reporter` table
- [`reports/project-evaluation.md`](./reports/project-evaluation.md) —
  rubric-by-rubric writeup

---

## Organiser check-in flow

1. On **My Tickets**, each ticket card shows its **Token ID** prominently
   with a **Copy** button. The holder reads it out (or shows their phone)
   at the gate.
2. The organiser opens **Organise → Check-in tool**, types the token
   ID, and submits.
3. The app calls `invalidateTicket(tokenId)`. The contract:

- Verifies the caller is the event's organiser (or contract owner)
- Sets `ticketValid[tokenId] = false`
- Cancels any active resale listing on that ticket silently
- Emits `TicketInvalidated`

4. The ticket's card in the holder's wallet now shows a **Checked in**
   badge and can no longer be relisted.

---

## Security & privacy notes

- **Content-addressed metadata** — IPFS CIDs are hashes of the content
  they point to. An attacker cannot substitute a different JSON
  document without producing a different CID, so the pointer stored on
  chain unambiguously identifies the exact bytes.
- **No sensitive data in the UI** — wallet addresses, private keys,
  contract addresses, and internal IDs are not rendered anywhere the
  user can see them. The one exception is a holder's own **Token ID**,
  which is shown on their ticket card because they need it for
  check-in.
- **Reentrancy** — every external payable function (`buyTicket`,
  `buyMultipleTickets`, `buyResaleTicket`) carries `nonReentrant`, and
  internal logic follows checks-effects-interactions (counters are
  incremented **before** `call{value: …}`).
- **Royalty lock** — once any ticket has been sold, `royaltyBps` is
  frozen. Organisers cannot rewrite royalty terms on existing holders
  mid-event.
- **Payment failures surface** — ETH transfers are checked; failed
  organiser / seller / royalty / refund transfers revert the whole tx
  (no stuck funds, no partial state).

---

## Known issues & limitations

These are deliberate scope cuts and known trade-offs. They are not
blockers for the rubric but worth documenting up front.

- **Single-organiser by design.** `createEvent` is `onlyOwner`, so the
  contract deployer is the *only* address that can list events. This
  matches the rubric's "Only organiser deploys and creates events" but
  precludes a multi-tenant Eventbrite-style deployment. To support
  several organisers on one contract, replace `Ownable.onlyOwner` with
  a per-address allow-list (e.g. `AccessControl` with an
  `ORGANISER_ROLE`).
- **Cancellation does not refund.** `cancelEvent` blocks further
  primary sales and resales, but it does **not** refund holders who
  already bought. Primary-sale ETH is forwarded to the organiser
  immediately at purchase time, so the contract holds no funds to
  refund from. A future version could escrow primary-sale revenue
  until `event.date` and add a `claimRefund(tokenId)` for cancelled
  events.
- **No `IERC721Enumerable`.** `getTicketsOfUser(address)` is `O(n)` in
  the global token count — fine for views, never used on-chain. Adding
  `IERC721Enumerable` would speed enumeration but make every mint
  significantly more expensive (extra storage writes per token), which
  would defeat the §D gas-optimisation work.
- **Frontend uses `eth_call` polling, not WebSocket subscriptions.**
  The UI cache-busts via a `refreshKey` that's incremented after each
  successful write. We didn't wire `contract.on(...)` event
  subscriptions because they require a WebSocket provider (Alchemy /
  Infura key) in production; polling is simpler and "good enough" for
  a single-user DApp where every state change is triggered by the user.
- **IPFS pin durability is the organiser's responsibility.** If a
  Pinata pin lapses, the metadata document may become unreachable.
  The contract still works (the on-chain CID is unchanged, and the
  ticket is still a valid NFT), but display data degrades to the
  fallback gradient placeholder. Mitigation: pin to multiple
  providers (Pinata + Web3.Storage + a personal Kubo node).
- **Branch coverage is 70 %.** Line and function coverage are
  comfortably above the 70 % rubric target (99.10 % / 100 %), but
  branch coverage sits exactly at the threshold because of
  short-circuit fall-throughs in compound `&&` `require` conditions.
  Squeezing those last branches would add tests with diminishing
  signal-to-noise (both halves of an `&&` being false simultaneously).
- **Free-ticket bypass on the resale cap.** The 2× resale-price cap
  is bypassed when the primary price is `0` (free ticket), because
  `0 × 2 = 0` would otherwise make free tickets un-resellable. This
  is intentional and documented in `MAX_RESALE_PRICE_MULTIPLIER`'s
  NatSpec.
- **Node 20+ recommended.** Hardhat 2 emits a warning on Node 23
  ("not officially supported"), but every test passes on Node 20 and
  Node 23. CI runs on Node 20.

---

## Scripts reference

Root `package.json`:

| Command                  | What it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `npm run compile`        | Compile the Solidity source                          |
| `npm run test`           | Run the full Hardhat test suite                      |
| `npm run deploy:local`   | Deploy + seed demo events on `http://127.0.0.1:8545` |
| `npm run deploy:sepolia` | Deploy + seed demo events on Sepolia                 |
| `npm run node`           | Start a local Hardhat dev chain                      |

`frontend/package.json`:

| Command           | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `npm run dev`     | Start Vite dev server on `http://localhost:5173` |
| `npm run build`   | Production build into `frontend/dist`            |
| `npm run preview` | Serve the built app locally                      |
| `npm run lint`    | Run ESLint on the frontend                       |

---

## License

ISC — see `package.json`.
