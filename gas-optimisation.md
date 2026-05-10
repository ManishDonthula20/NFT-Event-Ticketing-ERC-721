# Gas Optimisation — Before / After

**Rubric:** D.2 — *One concrete optimisation shown with before/after numbers
and explanation* — 2 marks.

## The optimisation

> **Move all human-readable event metadata off-chain onto IPFS. Store only
> a single `metadataURI` pointer on-chain. Stop storing `name`,
> `category`, `description`, and `section.name` in contract storage.**

This is the canonical ERC-721 pattern (`tokenURI = "ipfs://<CID>"`) and
it is exactly what the rubric's **§H. On-Chain vs Off-Chain Data** box
recommends ("Token metadata JSON … store on IPFS; tokenURI returns the
IPFS CID").

| | Before (commit `ed3fdd7`) | After (commit `c01d78b`) |
|---|---|---|
| `EventInfo` fields        | `name`, `category`, `description`, `metadataURI`, dates, royalty, counters | `metadataURI`, dates, royalty, counters |
| `Section` fields          | `name`, `priceWei`, `maxTickets`, `ticketsSold` | `priceWei`, `maxTickets`, `ticketsSold` |
| `createEvent` signature   | `(string name, string category, string description, uint256 date, uint96 royaltyBps, uint32 maxPerBuyer, (string,uint256,uint256)[] sections)` | `(string metadataURI, uint256 date, uint96 royaltyBps, uint32 maxPerBuyer, (uint256,uint256)[] sections)` |
| `updateEvent` signature   | `(uint256, string name, string category, string description, uint256, uint96, uint32)` | `(uint256, string metadataURI, uint256, uint96, uint32)` |
| tokenURI                  | built from on-chain `metadataURI` + tokenId | unchanged (still `<metadataURI>/<tokenId>.json`) |

## Before / after measurements

Both sets of numbers were produced by running the **same test suite**
(61 tests) with `hardhat-gas-reporter` enabled. See
[`docs/README.md`](./README.md#how-to-regenerate-the-before-gas-numbers)
for the exact commands.

Output:
- Before — [`reports/gas-report-before.txt`](./reports/gas-report-before.txt)
- After  — [`reports/gas-report.pdf`](./reports/gas-report.pdf)

### `createEvent` (the headline number)

| Measurement | Before | After | Saved | Δ |
|---|---:|---:|---:|---:|
| **Min**  | 313,285 | 240,951 |  **72,334** | **−23.1%** |
| **Max**  | 480,147 | 357,606 | **122,541** | **−25.5%** |
| **Avg**  | 389,440 | 296,739 |  **92,701** | **−23.8%** |

### `updateEvent`

| Measurement | Before | After | Saved | Δ |
|---|---:|---:|---:|---:|
| **Min**  | 49,682 | 39,230 | 10,452 | −21.0% |
| **Max**  | 54,789 | 47,185 |  7,604 | −13.9% |
| **Avg**  | 53,087 | 44,533 |  8,554 | −16.1% |

### Deployment

| Measurement | Before | After | Saved | Δ |
|---|---:|---:|---:|---:|
| **Deploy** | 3,890,180 | 3,539,138 | **351,042** | **−9.0%** |

### Everything else

Purchase, resale, and admin flows are **unchanged** (differences < 0.01%),
because they never touched the removed strings. This confirms the
optimisation is surgical: no regression anywhere else.

| Function | Before avg | After avg | Δ |
|---|---:|---:|---:|
| buyTicket              | 250,794 | 250,776 | −18 |
| buyMultipleTickets     | 470,978 | 470,948 | −30 |
| buyResaleTicket        |  98,907 |  98,918 | +11 |
| listForResale          | 169,290 | 169,282 |  −8 |
| cancelResaleListing    |  45,394 |  45,388 |  −6 |
| invalidateTicket       |  41,009 |  41,003 |  −6 |
| cancelEvent            |  30,684 |  30,676 |  −8 |
| addTicketsToSection    |  44,261 |  44,255 |  −6 |

## Why this works (cost model)

Gas cost at a glance (from the Yellow Paper / EIP-2929):

- **`SSTORE` on a fresh slot**: 20,000 gas + 2,100 gas access cost
- **`SSTORE` on a warm slot**: 2,900 gas
- **Calldata**: 16 gas / non-zero byte, 4 gas / zero byte
- A Solidity `string` stored in contract storage occupies 1 length slot
  plus `⌈len / 32⌉` data slots

Typical event metadata sizes in the seed data of `scripts/deploy.js`:

| Field        | Typical length | Slots  |
|---|---:|---:|
| `name`        |  25–40 chars   | 2 |
| `category`    |  10–15 chars   | 1 (short-string optimisation) |
| `description` | 120–300 chars  | 4–10 |
| `section.name` × 3 | 6–15 chars each | 3 (one per section) |

**Cold-slot SSTOREs saved per `createEvent`** (typical 3-section event):

`2 (name) + 1 (category) + 5 (desc avg) + 3 (section names) = ~11 cold SSTOREs`

`11 × 22,100 ≈ 243,100 gas`

Realised saving (measured): **~92,701 gas avg**. The delta vs. the
theoretical number is because:

- Short strings ≤ 31 bytes are packed into a single slot with the length
  encoded in the low byte, so they cost 1 SSTORE, not 2.
- The compiler (0.8.28, `viaIR: true`, runs=200) optimises some writes
  into fewer SSTOREs where memory expansion costs dominate.
- Calldata savings (non-zero bytes going from `name+cat+desc+section.name`
  down to just a ~60-byte IPFS URI) also contribute ~2,000–4,000 gas.

## Second-order benefits

1. **Smaller deployment** — 351,042 gas saved on deploy (one-time, but
   applies once per chain).
2. **Cheaper event creation for organisers** — every organiser saves
   ~92k gas / ~0.003 ETH at 30 gwei, per event.
3. **GDPR-friendly metadata surface** — anything describable (banner art,
   rich text, venue details, artists) lives in a mutable IPFS pin that
   can be updated by re-pointing `metadataURI`. The on-chain record is
   the minimal set required by contract logic.
4. **Larger descriptions are now free** — increasing a description from
   300 chars to 3,000 chars has **zero** on-chain cost impact; before,
   it would have added ~85 more cold SSTOREs (~1.9M gas).

## Reproducing these numbers

```bash
# "After" numbers (current tree)
npm run gas-report:file
# → docs/reports/gas-report.txt

# "Before" numbers (pre-refactor, commit ed3fdd7)
git worktree add /tmp/bys-before ed3fdd7
ln -s "$PWD/node_modules" /tmp/bys-before/node_modules
cd /tmp/bys-before
SEPOLIA_RPC_URL=http://unused \
  PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001 \
  REPORT_GAS=true npx hardhat test
cd - && rm /tmp/bys-before/node_modules
git worktree remove /tmp/bys-before --force
```
