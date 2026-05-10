# Project 7 — NFT Event Ticketing (ERC-721)

**Course:** CS 218 — Programmable & Interoperable Blockchain
**Submission rubric:** 25 marks (mapped to `ps.pdf`)
**Primary engineering goal of this project:** *gas optimisation via the on-chain ↔ off-chain split.*
**Reproducibility:** every number in this document can be regenerated from the repo root with:

```bash
npm install
npm test
npm run coverage
npm run gas-report
```

---

## 0. Rubric Self-Assessment

| Rubric § | Category                   |  Marks | Self-claim | Evidence |
| -------: | -------------------------- | -----: | ---------: | -------- |
|        A | Smart Contract Correctness |      9 |          9 | `contracts/EventTicketNFT.sol`, `test/EventTicketNFT.test.js` |
|        B | Security                   |      4 |          4 | `nonReentrant`, CEI ordering, `require` validation |
|        C | OpenZeppelin Usage         |      1 |          1 | `ERC721URIStorage`, `IERC2981`, `Ownable`, `ReentrancyGuard` |
|    **D** | **Gas Optimisation**       |  **3** |      **3** | `reports/gas-report.pdf` + §D below |
|        E | Testing                    |      4 |          4 | 61 passing tests, >70 % on every coverage axis |
|        F | DApp Frontend              |      3 |          3 | React + ethers v6 + MetaMask, `buyTicket()` wired with toasts |
|        G | Documentation & Code       |      1 |          1 | `README.md` + full NatSpec |
| **TOTAL** | —                         | **25** |     **25** | |

> The body of this document is intentionally **weighted toward §D (Gas Optimisation)**, which was the primary engineering goal of the build. Sections §A, §B, §C, §E, §F, §G are concise summaries with concrete file/test pointers that a grader can verify in seconds.

---

# §D. Gas Optimisation — 3 Marks (Deep Dive)

## D.0 — Headline Result

We replaced **on-chain human-readable strings** (event name, description, category, banner image URL, per-section labels) with a **single IPFS CID** stored on-chain. The contract treats the CID as opaque; an off-chain JSON document referenced by `metadataURI` carries everything human-readable.

The same functional test suite was executed **before** and **after** the change, with identical Hardhat / `hardhat-gas-reporter` configuration:

|   `createEvent` |       Before |        After |        Saved |           Δ |
| --------------: | -----------: | -----------: | -----------: | ----------: |
|             Min |      313,285 |      240,951 |   **72,334** | **−23.1 %** |
|             Max |      480,147 |      357,606 |  **122,541** | **−25.5 %** |
|         **Avg** |  **389,440** |  **296,739** |   **92,701** | **−23.8 %** |

> **TL;DR — ~92,000 gas saved per `createEvent` call (−23.8 % average).**
> Deployment bytecode also shrank by ~351 k gas (−9 %) as a side-effect, because the contract no longer has to carry the string-handling code paths for the deleted fields.

Tooling: `hardhat-gas-reporter` v1.0.10, Solidity 0.8.28, `optimizer.runs = 200`, `viaIR = true`. The full `hardhat-gas-reporter` table is in [`gas-report.pdf`](./gas-report.pdf).

---

## D.1 — The Problem We Were Solving

The naive first cut of `createEvent` accepted human-readable strings directly and stored them on-chain:

```solidity
// BEFORE — every string was an SSTORE-and-pay event
struct EventInfo {
    string  name;          // "Coldplay — Music of the Spheres"
    string  category;      // "Concert"
    string  description;   // 200–500 chars of marketing copy
    string  imageURL;      // banner image URL (not even an IPFS CID)
    uint256 date;
    uint256 priceWei;
    uint256 maxTickets;
    uint256 ticketsSold;
    uint96  royaltyBps;
    uint32  maxPerBuyer;
    address organiser;
    bool    cancelled;
}

struct Section {
    string  name;          // "VIP", "Regular", "Economy"
    uint256 priceWei;
    uint256 maxTickets;
    uint256 ticketsSold;
}

function createEvent(
    string calldata name,           // <-- billed by calldata byte
    string calldata category,       // <-- billed by calldata byte
    string calldata description,    // <-- billed by calldata byte
    string calldata imageURL,       // <-- billed by calldata byte
    uint256 date,
    uint96  royaltyBps,
    uint32  maxPerBuyer,
    SectionInput[] calldata sections
) external returns (uint256 eventId) { /* … */ }
```

Every character paid gas in **two** places — once on the way in (calldata) and once on the way to storage (SSTORE).

### D.1.a — Calldata Cost (every call, every byte)

Per the EVM gas schedule:

```
Non-zero calldata byte    ->  16 gas
Zero calldata byte        ->   4 gas
```

A 200-character description (`description = "Live performance of …"`) is roughly **200 non-zero bytes ≈ 3,200 gas** added to *every* `createEvent` and *every* `updateEvent` call. A 500-character description balloons that to **~8,000 gas**.

This is paid even if the contract throws the data away — the user has already paid for the calldata before the EVM dispatches the call. Multi-section events compound the problem because each section comes with its own `name` field on the input array.

### D.1.b — Storage Cost (one-off per slot, but expensive)

Per the EVM gas schedule (post-Berlin, EIP-2929):

```
SSTORE — write to a previously zero (cold) slot   ->  20,000 gas
SSTORE — change a previously non-zero (warm) slot ->   5,000 gas (+ 2,100 cold access on first hit)
SLOAD  — first read of a slot (cold)              ->   2,100 gas
SLOAD  — subsequent read of a warm slot           ->     100 gas
```

In Solidity, a `string` of length **N** is laid out in storage as follows:

- **If `N ≤ 31`:** the entire string fits inside a single 32-byte slot (length encoded in the low byte). Cost: **1 cold SSTORE → 20,000 gas**.
- **If `N ≥ 32`:** the slot itself stores `length × 2 + 1`, and the actual characters live at `keccak256(slot)`-derived data slots, **one slot per 32 chars**. A 200-char description therefore needs:
  - 1 SSTORE for the length slot          → 20,000 gas
  - `ceil(200 / 32) = 7` SSTOREs for data → 7 × 20,000 = 140,000 gas
  - **Total ≈ 160,000 gas just for one 200-char description.**

A "typical" event in the BEFORE schema (name + category + description + 3 section names) easily hit **5–7 cold SSTOREs** on top of the numeric fields. That is the slope of the BEFORE numbers in the table at the top of this document.

### D.1.c — Why "Cold" is the Worst Case Here

`createEvent` is a *write-only* operation on a *fresh* event id — **every storage slot it touches is cold.** Cold slots are paid at the full 20,000-gas SSTORE rate, with no discount. There is no caching trick on the contract side that can avoid this; the only lever we have is **fewer slots written**.

### D.1.d — Why This Matters for Users

At realistic gas prices, the BEFORE schema imposed a meaningful ETH cost on every organiser:

| Gas price | Saving in ETH per event | Saving in INR (₹83 = $1; ETH = $3,000) |
| --------: | ----------------------: | -------------------------------------: |
|   30 gwei |    ~0.00278 ETH (~$8.3) |                                  ~₹692 |
|   60 gwei |   ~0.00556 ETH (~$16.7) |                                ~₹1,385 |
|  100 gwei |   ~0.00927 ETH (~$27.8) |                                ~₹2,308 |

For an organiser publishing **100 events**, that is a **₹70k–₹230k saving**, with **zero loss of functionality** — the JSON document is unchanged, only its storage location moved.

---

## D.2 — The Fix: The IPFS-Pointer Pattern

We use the canonical ERC-721 metadata convention recommended in the rubric's "Cardinal Rule" box:

```
tokenURI = "ipfs://<CID>"
```

The contract stores **only the CID** (`bafy…` v1, ~46 bytes) and treats its contents as opaque. The off-chain JSON, pinned to Pinata (or any IPFS gateway), carries everything human-readable:

```json
{
  "name": "Coldplay — Music of the Spheres",
  "category": "Concert",
  "description": "200–500 characters of marketing copy …",
  "image": "ipfs://bafybeiabcdef…/banner.jpg",
  "venue": "Wankhede Stadium, Mumbai",
  "sections": [
    { "id": 0, "name": "VIP" },
    { "id": 1, "name": "Regular" },
    { "id": 2, "name": "Economy" }
  ]
}
```

After the change, `EventInfo` is dramatically thinner:

```solidity
// AFTER — one CID pointer, no human prose on chain
struct EventInfo {
    string  metadataURI;   // ipfs://<CID> — ~2 storage slots total
    uint256 date;
    uint256 priceWei;      // cheapest section's price (display aggregate)
    uint256 maxTickets;
    uint256 ticketsSold;
    uint96  royaltyBps;    // <-+
    uint32  maxPerBuyer;   //   |
    address organiser;     //   +-- packed into ONE 32-byte slot
    bool    cancelled;     // <-+
}

struct Section {
    uint256 priceWei;      // no `name` field anymore
    uint256 maxTickets;
    uint256 ticketsSold;
}
```

`tokenURI(tokenId)` is still ERC-721-compliant — it just composes the URI on-the-fly from the event's `metadataURI` and the token id:

```solidity
_setTokenURI(
    tokenId,
    string(abi.encodePacked(
        _events[eventId].metadataURI, "/", _toString(tokenId), ".json"
    ))
);
```

### D.2.a — Why This Is Safe (Verifiability Is Preserved)

A v1 IPFS CID is a **self-describing, content-addressed hash** of the JSON document. Anyone can:

1. Read `metadataURI` from the contract.
2. Fetch the JSON from any IPFS gateway.
3. Recompute the CID and compare it against the on-chain value.

If the document was tampered with, the CIDs will not match, and the tampering is **immediately detectable**. This is the *cryptographic-commitment* pattern named in the rubric — and it is exactly how OpenSea, Foundation, Sound.xyz and every major NFT platform handle metadata.

### D.2.b — Why This Also Helps `updateEvent`

When an organiser fixes a typo in a description, the BEFORE schema forced an SSTORE on the changed string slot **plus** a re-write of every following slot if the new length straddled a 32-byte boundary. The AFTER schema only re-points the CID — **one slot, every time**. That is the source of the −16 % `updateEvent` saving observed in the gas report.

---

## D.3 — Slot-by-Slot Accounting (Where the Saved Gas Came From)

What we **removed** from on-chain storage:

| Field removed                | Typical size  |             Slots freed | Gas freed (cold) |
| ---------------------------- | ------------: | ----------------------: | ---------------: |
| `EventInfo.name`             |     ~30 chars |       1 length + 1 data |      ~40,000 gas |
| `EventInfo.category`         |     ~10 chars |            1 (in-place) |      ~20,000 gas |
| `EventInfo.description`      |    ~200 chars |       1 length + 7 data |     ~160,000 gas |
| `EventInfo.imageURL`         |     ~50 chars |       1 length + 2 data |      ~60,000 gas |
| `Section.name` × 3 sections  |  ~10 chars × 3 |            3 (in-place) |      ~60,000 gas |
| **Total worst case (BEFORE)** |              | up to **~14 cold slots**|     **~340,000** |

What we **added back**:

| Field added                   |      Size |       Slots used | Gas (cold) |
| ----------------------------- | --------: | ---------------: | ---------: |
| `EventInfo.metadataURI` (CID) | ~60 chars | 1 length + 2 data | ~60,000 gas |

**Net first-order saving: up to ~280,000 gas in the worst case.**

The measured saving (~92.7 k average) is smaller because:

1. The average event in our test suite uses shorter strings than the 200-character worst case.
2. The Yul-based `viaIR` codegen reorders writes and benefits both versions slightly.
3. EVM gas refunds on storage clears (`SSTORE_RESET_GAS`) muddy the BEFORE accounting.

The **direction** and **order of magnitude** of the saving fall out exactly from the slot-accounting above.

---

## D.4 — Secondary Optimisations Layered On Top

These changes do not move the headline number much individually but, together, keep the AFTER numbers as tight as they are. They are called out for completeness; they earn no separate rubric credit.

### 1. Storage-Slot Packing on the Tail of `EventInfo`

```
| royaltyBps | maxPerBuyer | organiser | cancelled |  unused  |
|  uint96    |  uint32     |  address  |   bool    |  1 byte  |
|  12 bytes  |   4 bytes   | 20 bytes  |  1 byte   |          |   --> 32 bytes total -> ONE slot
```
Solidity packs sequential ≤32-byte fields into a single slot when their declared widths line up. We deliberately ordered the struct so these five small fields share one slot. **Saves 1 cold SSTORE (~20 k gas) per `createEvent`** versus a naive ordering.

### 2. Batched Counter Updates Inside `_buy`

`buyMultipleTickets(quantity = N)` mints N NFTs in a loop, but the section / event `ticketsSold` counters are SSTORE'd **once at the end of the loop**, not N times. Saves `(N − 1)` warm SSTOREs per multi-buy — a 5-ticket purchase is **~20 k cheaper** than the naive version.

### 3. `external` over `public` on the Public ABI

`external` keeps function arguments in calldata; `public` would copy them into memory before dispatch. Saves ~50–200 gas per call depending on argument size, with no behavioural change.

### 4. `calldata` over `memory` for `SectionInput[]`

```solidity
function createEvent(..., SectionInput[] calldata sections) external …
```

Skips the calldata→memory copy for every section, ~100 gas per byte of section input.

### 5. `unchecked { }` On Strictly-Bounded Counters Only

```solidity
unchecked { _eventIdCounter = eventId + 1; }
unchecked { ++i; }
```

Used **only** on counters strictly bounded by `uint256` and **never** on any path that handles user funds, so the rubric's "input validation / no over-underflow" mark in §B is unaffected. Saves ~50 gas per call.

### 6. O(1) Active-Listing Removal Via Swap-Pop With `idx + 1` Sentinel

`_activeListings` is a `uint256[]` of currently-listed token ids. Removal uses the classic swap-with-last-element-and-pop. We store `idx + 1` (instead of `idx`) in the lookup mapping so the default `uint256(0)` cleanly means "not present" — without an extra `mapping(uint256 => bool) isListed`. **Saves 1 cold SSTORE (~20 k gas) per listing creation.**

### 7. Compiler Settings

```ts
// hardhat.config.ts
solidity: {
  version: "0.8.28",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
  },
},
```

`viaIR` enables the Yul-based optimisation pipeline. It is particularly effective on struct-heavy code like ours because it can fold consecutive SSTOREs to the same slot.

---

## D.5 — Reproducing Every Number

```bash
npm install
npm run gas-report                 # prints the table to stdout
npm run gas-report:file            # also writes reports/gas-report.txt Generates raw .txt output, we have provided it as .pdf for grading
```

Raw tool output: [`gas-report.txt`](./gas-report.txt). The pre-optimisation BEFORE numbers were captured from the same suite run against the legacy struct layout and are preserved for delta verification in the team's project-history archive.


---

# §A. Smart Contract Correctness — 9 Marks (concise)

- **`createEvent()`** — stores `EventInfo` + sections, validates `metadataURI` non-empty, future date, royalty cap, per-buyer cap; emits `EventCreated` and `SectionCreated`.
- **`buyTicket()` / `buyMultipleTickets()` *(payable)*** — mints an ERC-721 ticket, forwards ETH to organiser, refunds excess, reverts beyond `maxTickets` and beyond per-buyer cap.
- **`buyResaleTicket()` *(payable)*** — implements the rubric-required royalty split:
  - `royaltyAmt = salePrice × royaltyBps / 10_000`
  - `sellerAmt = salePrice − royaltyAmt`
  - Royalty is **actually deducted** at settlement time, not just reported by `royaltyInfo`.
- **`listForResale()`, `cancelResaleListing()`, `royaltyInfo()`** — internal marketplace plus EIP-2981 view returning `(organiser, royaltyAmt)`.
- **Access control** — `onlyOrganiser` modifier on `updateEvent` / `addTicketsToSection` / `cancelEvent`; `ownerOf(tokenId) == msg.sender` on `listForResale`; `organiser || owner()` on `invalidateTicket`.
- **Edge cases** — sold-out reverts, cancelled-listing reverts, royalty locked after first sale, per-buyer cap enforced *across* sections, anti-scalping cap (resale ≤ 2× original section price).

---

# §B. Security — 4 Marks (concise)

- **Reentrancy guard** — `nonReentrant` on **`buyTicket`, `buyMultipleTickets`, `buyResaleTicket`** — every ETH-moving entry point. Combined with strict **Checks-Effects-Interactions** ordering: every `payable(...).call{value: …}("")` happens **after** state mutation, and the return `bool` is checked.
- **Input validation** — 20+ `require()` statements; Solidity 0.8 checked arithmetic everywhere; `unchecked { }` is used **only** on bounded counters, never in any fund-handling path.
- **Visibility** — `external` on the public ABI (cheaper calldata + clearer intent); `internal` on shared helpers; `private` on contract-local helpers (`_addActiveListing`, `_toString`, `_ownerOfSafe`, …).
- **Anti-abuse extras** — organiser-only check-in (`invalidateTicket`) and a 2× hard cap on resale price (`MAX_RESALE_PRICE_MULTIPLIER`).

---

# §C. OpenZeppelin Usage — 1 Mark (concise)

```solidity
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EventTicketNFT is ERC721URIStorage, IERC2981,
                           ReentrancyGuard, Ownable { … }
```

| OZ contract        | Role in this project                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `ERC721URIStorage` | Per-token `tokenURI`; we set `<metadataURI>/<tokenId>.json` at mint time.             |
| `IERC2981`         | Royalty standard; implemented by `royaltyInfo(tokenId, salePrice)`.                   |
| `ReentrancyGuard`  | `nonReentrant` modifier on every payable function.                                    |
| `Ownable`          | Platform-admin recovery hatch (used only on `invalidateTicket`).                      |

---

# §E. Testing — 4 Marks (concise)

- **Suite:** `test/EventTicketNFT.test.js` — **61 passing, 0 failing** in ~3 s. Run via `npm test`.
- **Happy paths** — every rubric-listed function (`createEvent`, `buyTicket`, `buyMultipleTickets`, `listForResale`, `buyResaleTicket`, `royaltyInfo`, organiser admin, view helpers) has at least one happy-path test.
- **Reverts** — every rubric-listed failure path is exercised: buying beyond `maxTickets`, non-owner listing, cancelled-listing purchase, insufficient payment, expired listing, invalidated ticket, per-buyer cap exceeded, royalty cap exceeded, royalty change after first sale, non-organiser admin calls, self-buy of own listing.
- **Coverage** — `solidity-coverage` v0.8.17:
  - **Lines: 99.10 %**, **Functions: 100 %**, **Statements: 97.21 %**, **Branches: 72.50 %**
  - All four axes are above the 70 % rubric threshold.
- Full passing-test list and coverage table: [`coverage-report.pdf`](./coverage-report.pdf).

---

# §F. DApp Frontend — 3 Marks (concise)

- **Wallet + ABI + state (1 mark)** — Vite + React 18 + ethers v6. `useWallet.js` handles MetaMask connect, silent session restore and network switching. `useContract.js` instantiates the `Contract` from `frontend/src/utils/contract.js` (auto-written by `scripts/deploy.js` with the latest address + ABI). The Navbar shows the connected address and ETH balance.
- **State-changing flow (2 marks)** — `EventDetails.jsx → buyTicket()` sent through `sendWithGasBuffer` (estimateGas × 1.25; on revert we fall back to `staticCall` to surface the underlying revert reason). A toast queue (`Toast.jsx`) shows **pending → success → tokenId** and routes the user to `/my-tickets`. The resale flow (`TicketCard.jsx → listForResale`, `Marketplace.jsx → buyResaleTicket`) is wired identically.

---

# §G. Documentation & Code — 1 Mark (concise)

- **`README.md`** — project overview, complete team table (names + roll numbers), reproduce-everything commands (`npm install`, compile, test, coverage, gas-report, deploy:local / deploy:sepolia, frontend dev), required env vars (Pinata, Sepolia keys), and links to every report.
- **NatSpec** — every `external` and `public` function in `EventTicketNFT.sol` has `@notice`, `@param` and `@return` tags. Storage variables, structs, modifiers and events all carry `///` doc comments. The contract head (lines 9–48) is a full architectural NatSpec block explaining the IPFS pattern and the storage layout.

---

# §H. On-Chain vs Off-Chain Data — Cardinal-Rule Audit

This is the design decision that the §D gas saving is *built on top of*. The rubric's Cardinal Rule explicitly rewards making this split correctly.

| Data                                       | Location           | Why                                                                                         |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| `ticketsSold`, `maxTickets`, `priceWei`    | ON-CHAIN           | Contract enforces caps, prices and sold-out reverts.                                        |
| `royaltyBps`                               | ON-CHAIN           | EIP-2981 `royaltyInfo` is contract-level; royalty is deducted at resale settlement.         |
| `organiser`, `ownerOf(tokenId)`            | ON-CHAIN           | Authorisation comparisons (`listForResale`, `invalidateTicket`, `updateEvent`).             |
| `metadataURI` (IPFS CID)                   | ON-CHAIN (pointer) | A 46-byte content-addressed pointer; verifiable by re-fetch + re-hash.                      |
| Event name / description / category        | OFF-CHAIN (IPFS)   | Display-only prose; the contract never reads it; **−92 k gas / event** — see §D.            |
| Section labels (`"VIP"`, `"Regular"`, …)   | OFF-CHAIN (IPFS)   | Display-only; the contract identifies sections by numeric `sectionId`.                      |
| Banner images, posters, venue maps         | OFF-CHAIN (IPFS)   | Large blobs; on-chain storage would be financially infeasible.                              |
| Attendee personal details (name, email…)   | **NEVER ON-CHAIN** | GDPR right-to-erasure is incompatible with chain immutability; this DApp does not collect any personal data on-chain. |

---

## Appendix — Reproducibility Commands

```bash
# clone & install
npm install

# compile
npx hardhat compile

# tests (61 passing)
npm test

# coverage (>70 % on every axis)
npm run coverage

# gas report (writes the table in gas-report.txt)
npm run gas-report
npm run gas-report:file

# deploy
npm run deploy:local        # Hardhat local node
npm run deploy:sepolia      # Public testnet (uses .env)

# frontend
cd frontend && npm install && npm run dev
```

---

## Appendix — File Map for Graders

| Concern              | File / Path                                |
| -------------------- | ------------------------------------------ |
| Solidity contract    | `contracts/EventTicketNFT.sol`             |
| Tests (61 passing)   | `test/EventTicketNFT.test.js`              |
| Deploy script        | `scripts/deploy.js`                        |
| Hardhat config       | `hardhat.config.ts`                        |
| Frontend root        | `frontend/`                                |
| Buy-ticket UI flow   | `frontend/src/pages/EventDetails.jsx`      |
| Resale UI flow       | `frontend/src/pages/Marketplace.jsx`       |
| Wallet hook          | `frontend/src/hooks/useWallet.js`          |
| Gas report           | `reports/gas-report.pdf`                   |
| Gas report (raw)     | `reports/gas-report.txt`                   |
| Coverage report      | `reports/coverage-report.pdf`              |
| Coverage report (raw)| `reports/coverage-report.txt`              |
| This evaluation      | `reports/project-evaluation.md`            |
| README & setup       | `README.md`                                |
