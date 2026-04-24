const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } =
  require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Only the CID / URI lives on chain now — everything else (name, description,
// category, section labels, banner image) is expected to be in the JSON
// document this URI points at. The contract treats the URI as opaque.
const METADATA = "ipfs://bafybeigexamplecid";
const METADATA_V2 = "ipfs://bafybeigexamplenewcid";

// `getEvent` on an ethers.js Contract is shadowed by a built-in helper,
// so we always call the on-chain view via getFunction.
const getEv = (contract, eventId) =>
  contract.getFunction("getEvent")(eventId);

// Build a single "general" section — used by tests that don't care about
// divisions. Section labels are off-chain now, so each section is just
// (price, supply).
const singleSection = (priceWei, maxTickets) => [{ priceWei, maxTickets }];

describe("EventTicketNFT", function () {
  // -------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------
  async function deployFixture() {
    const [owner, organiser, buyer1, buyer2, buyer3, randomUser] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("EventTicketNFT");
    const contract = await Factory.deploy();
    await contract.waitForDeployment();

    const future = (await time.latest()) + 60 * 60 * 24 * 7; // +7 days

    return {
      contract,
      owner,
      organiser,
      buyer1,
      buyer2,
      buyer3,
      randomUser,
      future,
    };
  }

  async function eventCreatedFixture() {
    const deployed = await deployFixture();
    const { contract, organiser, future } = deployed;

    const price = ethers.parseEther("0.1");
    const royaltyBps = 1000; // 10%
    const maxTickets = 5;
    const maxPerBuyer = 3;

    const tx = await contract
      .connect(organiser)
      .createEvent(
        METADATA,
        future,
        royaltyBps,
        maxPerBuyer,
        singleSection(price, maxTickets)
      );
    await tx.wait();

    return { ...deployed, price, royaltyBps, maxTickets, maxPerBuyer };
  }

  async function multiSectionFixture() {
    const deployed = await deployFixture();
    const { contract, organiser, future } = deployed;

    const sections = [
      { priceWei: ethers.parseEther("0.5"),  maxTickets: 2 },  // VIP
      { priceWei: ethers.parseEther("0.2"),  maxTickets: 5 },  // Regular
      { priceWei: ethers.parseEther("0.05"), maxTickets: 10 }, // Economy
    ];

    await contract
      .connect(organiser)
      .createEvent(
        METADATA,
        future,
        500, // 5% royalty
        4,   // maxPerBuyer
        sections
      );

    return { ...deployed, sections };
  }

  // -------------------------------------------------------------------
  // Deployment
  // -------------------------------------------------------------------
  describe("Deployment", function () {
    it("deploys with correct name and symbol", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.name()).to.equal("EventTicket");
      expect(await contract.symbol()).to.equal("ETKT");
    });

    it("sets deployer as owner", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("starts with zero events and zero tokens", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.getEventCount()).to.equal(0);
      expect(await contract.getTokenCount()).to.equal(0);
    });

    it("supports ERC-721 and ERC-2981 interfaces", async function () {
      const { contract } = await loadFixture(deployFixture);
      expect(await contract.supportsInterface("0x80ac58cd")).to.equal(true);
      expect(await contract.supportsInterface("0x2a55205a")).to.equal(true);
    });
  });

  // -------------------------------------------------------------------
  // Event Creation
  // -------------------------------------------------------------------
  describe("createEvent", function () {
    it("stores event (with a single section) and emits EventCreated", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.2");
      await expect(
        contract
          .connect(organiser)
          .createEvent(
            METADATA,
            future,
            500,
            5,
            singleSection(price, 100)
          )
      )
        .to.emit(contract, "EventCreated")
        .withArgs(
          0,
          organiser.address,
          METADATA,
          future,
          1,      // sectionCount
          100,    // aggregate maxTickets
          500
        );

      const ev = await getEv(contract, 0);
      expect(ev.metadataURI).to.equal(METADATA);
      expect(ev.date).to.equal(future);
      expect(ev.priceWei).to.equal(price); // min price = only section
      expect(ev.maxTickets).to.equal(100);
      expect(ev.ticketsSold).to.equal(0);
      expect(ev.royaltyBps).to.equal(500);
      expect(ev.maxPerBuyer).to.equal(5);
      expect(ev.organiser).to.equal(organiser.address);
      expect(ev.cancelled).to.equal(false);

      expect(await contract.getSectionCount(0)).to.equal(1);
      const sec = await contract.getSection(0, 0);
      expect(sec.priceWei).to.equal(price);
      expect(sec.maxTickets).to.equal(100);
      expect(sec.ticketsSold).to.equal(0);
    });

    it("stores multiple sections and sets priceWei to the cheapest", async function () {
      const { contract, sections } = await loadFixture(multiSectionFixture);
      const ev = await getEv(contract, 0);

      // Aggregate max = 2 + 5 + 10 = 17
      expect(ev.maxTickets).to.equal(17);
      // priceWei aggregate = min of section prices
      expect(ev.priceWei).to.equal(ethers.parseEther("0.05"));

      expect(await contract.getSectionCount(0)).to.equal(3);
      const all = await contract.getSections(0);
      expect(all.length).to.equal(3);
      for (let i = 0; i < sections.length; i++) {
        expect(all[i].priceWei).to.equal(sections[i].priceWei);
        expect(all[i].maxTickets).to.equal(sections[i].maxTickets);
        expect(all[i].ticketsSold).to.equal(0);
      }
    });

    it("emits SectionCreated for each section", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      const sections = [
        { priceWei: ethers.parseEther("0.1"), maxTickets: 5 },
        { priceWei: ethers.parseEther("0.2"), maxTickets: 10 },
      ];
      const tx = await contract
        .connect(organiser)
        .createEvent(METADATA, future, 0, 2, sections);
      await expect(tx)
        .to.emit(contract, "SectionCreated")
        .withArgs(0, 0, sections[0].priceWei, 5);
      await expect(tx)
        .to.emit(contract, "SectionCreated")
        .withArgs(0, 1, sections[1].priceWei, 10);
    });

    it("reverts with empty metadataURI", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent("", future, 500, 5, singleSection(100, 10))
      ).to.be.revertedWith("metadataURI required");
    });

    it("reverts if date is in the past", async function () {
      const { contract, organiser } = await loadFixture(deployFixture);
      const past = (await time.latest()) - 10;
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, past, 500, 5, singleSection(100, 10))
      ).to.be.revertedWith("Event must be at least 1 day in the future");
    });

    it("reverts if date is less than 1 day in the future", async function () {
      const { contract, organiser } = await loadFixture(deployFixture);
      const soon = (await time.latest()) + 60 * 60;
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, soon, 500, 5, singleSection(100, 10))
      ).to.be.revertedWith("Event must be at least 1 day in the future");
    });

    it("reverts if no sections provided", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, future, 500, 5, [])
      ).to.be.revertedWith("At least one section required");
    });

    it("reverts if a section has maxTickets = 0", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, future, 500, 5, [
            { priceWei: 100, maxTickets: 0 },
          ])
      ).to.be.revertedWith("Section maxTickets must be > 0");
    });

    it("reverts if royalty exceeds cap (5000 bps = 50%)", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, future, 5001, 5, singleSection(100, 10))
      ).to.be.revertedWith("Royalty exceeds cap");
    });

    it("reverts if maxPerBuyer is zero", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, future, 500, 0, singleSection(100, 10))
      ).to.be.revertedWith("maxPerBuyer must be > 0");
    });

    it("reverts if maxPerBuyer exceeds GLOBAL_MAX_PER_BUYER", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      await expect(
        contract
          .connect(organiser)
          .createEvent(METADATA, future, 500, 9999, singleSection(100, 10))
      ).to.be.revertedWith("maxPerBuyer exceeds global cap");
    });

    it("increments eventId counter", async function () {
      const { contract, organiser, future } = await loadFixture(deployFixture);
      for (let i = 0; i < 3; i++) {
        await contract
          .connect(organiser)
          .createEvent(METADATA, future, 500, 5, singleSection(100, 10));
      }
      expect(await contract.getEventCount()).to.equal(3);
    });
  });

  // -------------------------------------------------------------------
  // Buy Ticket (Primary)
  // -------------------------------------------------------------------
  describe("buyTicket (sectioned)", function () {
    it("mints NFT from the chosen section and transfers ETH to organiser", async function () {
      const { contract, organiser, buyer1, price } = await loadFixture(
        eventCreatedFixture
      );
      const balBefore = await ethers.provider.getBalance(organiser.address);

      await expect(
        contract.connect(buyer1).buyTicket(0, 0, { value: price })
      )
        .to.emit(contract, "TicketMinted")
        .withArgs(1, 0, 0, buyer1.address, price);

      expect(await contract.ownerOf(1)).to.equal(buyer1.address);
      expect(await contract.getTokenCount()).to.equal(1);
      expect(await contract.tokenToSection(1)).to.equal(0);

      const balAfter = await ethers.provider.getBalance(organiser.address);
      expect(balAfter - balBefore).to.equal(price);
    });

    it("charges each section its own price", async function () {
      const { contract, organiser, buyer1, buyer2, sections } = await loadFixture(
        multiSectionFixture
      );
      const balBefore = await ethers.provider.getBalance(organiser.address);

      // Buy a VIP (section 0, 0.5 ETH)
      await contract.connect(buyer1).buyTicket(0, 0, { value: sections[0].priceWei });
      // Buy an Economy (section 2, 0.05 ETH)
      await contract.connect(buyer2).buyTicket(0, 2, { value: sections[2].priceWei });

      const balAfter = await ethers.provider.getBalance(organiser.address);
      expect(balAfter - balBefore).to.equal(sections[0].priceWei + sections[2].priceWei);

      const vip = await contract.getSection(0, 0);
      const eco = await contract.getSection(0, 2);
      expect(vip.ticketsSold).to.equal(1);
      expect(eco.ticketsSold).to.equal(1);

      // Aggregate event counter reflects both sales
      const ev = await getEv(contract, 0);
      expect(ev.ticketsSold).to.equal(2);
    });

    it("records per-token section so buyers know what they got", async function () {
      const { contract, buyer1, sections } = await loadFixture(multiSectionFixture);
      await contract.connect(buyer1).buyTicket(0, 1, { value: sections[1].priceWei });
      expect(await contract.tokenToSection(1)).to.equal(1);
      const sec = await contract.getSectionOfToken(1);
      expect(sec.priceWei).to.equal(sections[1].priceWei);
    });

    it("sets tokenURI derived from event metadata + tokenId", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      expect(await contract.tokenURI(1)).to.equal(`${METADATA}/1.json`);
    });

    it("refunds excess ETH to buyer", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      const overpay = price + ethers.parseEther("0.05");
      const balBefore = await ethers.provider.getBalance(buyer1.address);
      const tx = await contract.connect(buyer1).buyTicket(0, 0, { value: overpay });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(buyer1.address);
      expect(balBefore - balAfter).to.equal(price + gasCost);
    });

    it("reverts if event does not exist", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).buyTicket(99, 0, { value: price })
      ).to.be.revertedWith("Event does not exist");
    });

    it("reverts with invalid section id", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).buyTicket(0, 5, { value: price })
      ).to.be.revertedWith("Invalid section");
    });

    it("reverts with insufficient payment", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).buyTicket(0, 0, { value: price - 1n })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("reverts when a section is sold out", async function () {
      const { contract, buyer1, buyer2, sections } = await loadFixture(multiSectionFixture);
      // VIP has only 2 tickets.
      await contract.connect(buyer1).buyTicket(0, 0, { value: sections[0].priceWei });
      await contract.connect(buyer1).buyTicket(0, 0, { value: sections[0].priceWei });
      await expect(
        contract.connect(buyer2).buyTicket(0, 0, { value: sections[0].priceWei })
      ).to.be.revertedWith("Not enough tickets in section");
    });

    it("reverts when event date has passed", async function () {
      const { contract, buyer1, price, future } = await loadFixture(eventCreatedFixture);
      await time.increaseTo(future + 1);
      await expect(
        contract.connect(buyer1).buyTicket(0, 0, { value: price })
      ).to.be.revertedWith("Event already finished");
    });

    it("reverts when event is cancelled", async function () {
      const { contract, organiser, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(organiser).cancelEvent(0);
      await expect(
        contract.connect(buyer1).buyTicket(0, 0, { value: price })
      ).to.be.revertedWith("Event cancelled");
    });

    it("enforces per-buyer cap across sections", async function () {
      const { contract, buyer1, sections } = await loadFixture(multiSectionFixture);
      // maxPerBuyer = 4. Mix of sections.
      await contract.connect(buyer1).buyTicket(0, 0, { value: sections[0].priceWei });
      await contract.connect(buyer1).buyTicket(0, 1, { value: sections[1].priceWei });
      await contract.connect(buyer1).buyTicket(0, 2, { value: sections[2].priceWei });
      await contract.connect(buyer1).buyTicket(0, 2, { value: sections[2].priceWei });
      await expect(
        contract.connect(buyer1).buyTicket(0, 2, { value: sections[2].priceWei })
      ).to.be.revertedWith("Per-buyer cap exceeded");
    });
  });

  // -------------------------------------------------------------------
  // Buy Multiple Tickets
  // -------------------------------------------------------------------
  describe("buyMultipleTickets", function () {
    it("mints multiple NFTs from the same section", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      const qty = 3;
      await contract
        .connect(buyer1)
        .buyMultipleTickets(0, 0, qty, { value: price * BigInt(qty) });

      for (let i = 1; i <= qty; i++) {
        expect(await contract.ownerOf(i)).to.equal(buyer1.address);
        expect(await contract.tokenToSection(i)).to.equal(0);
      }
      expect(await contract.getTokenCount()).to.equal(qty);
    });

    it("reverts if section supply exceeded", async function () {
      const { contract, buyer1, sections } = await loadFixture(multiSectionFixture);
      await expect(
        contract
          .connect(buyer1)
          .buyMultipleTickets(0, 0, 3, { value: sections[0].priceWei * 3n })
      ).to.be.revertedWith("Not enough tickets in section");
    });

    it("reverts if per-buyer cap exceeded", async function () {
      const { contract, buyer1, price, maxPerBuyer } = await loadFixture(
        eventCreatedFixture
      );
      await expect(
        contract
          .connect(buyer1)
          .buyMultipleTickets(0, 0, maxPerBuyer + 1, {
            value: price * BigInt(maxPerBuyer + 1),
          })
      ).to.be.revertedWith("Per-buyer cap exceeded");
    });

    it("reverts with quantity 0", async function () {
      const { contract, buyer1 } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).buyMultipleTickets(0, 0, 0, { value: 0 })
      ).to.be.revertedWith("quantity must be > 0");
    });

    it("reverts with insufficient payment", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).buyMultipleTickets(0, 0, 2, { value: price })
      ).to.be.revertedWith("Insufficient payment");
    });
  });

  // -------------------------------------------------------------------
  // Resale Listing
  // -------------------------------------------------------------------
  describe("listForResale", function () {
    async function holdTicketFixture() {
      const d = await eventCreatedFixture();
      await d.contract.connect(d.buyer1).buyTicket(0, 0, { value: d.price });
      return d;
    }

    it("lists ticket owned by caller and emits event", async function () {
      const { contract, buyer1 } = await loadFixture(holdTicketFixture);
      const resalePrice = ethers.parseEther("0.15");
      await expect(contract.connect(buyer1).listForResale(1, resalePrice, 0))
        .to.emit(contract, "TicketListedForResale")
        .withArgs(1, buyer1.address, resalePrice, 0);

      const listing = await contract.getResaleListing(1);
      expect(listing.seller).to.equal(buyer1.address);
      expect(listing.price).to.equal(resalePrice);
      expect(listing.active).to.equal(true);
    });

    it("adds tokenId to active listings list", async function () {
      const { contract, buyer1 } = await loadFixture(holdTicketFixture);
      await contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), 0);
      const active = await contract.getActiveListings();
      expect(active.map((x) => Number(x))).to.include(1);
    });

    it("reverts if caller is not owner", async function () {
      const { contract, buyer2 } = await loadFixture(holdTicketFixture);
      await expect(
        contract.connect(buyer2).listForResale(1, ethers.parseEther("0.15"), 0)
      ).to.be.revertedWith("Not ticket owner");
    });

    it("reverts if already listed", async function () {
      const { contract, buyer1 } = await loadFixture(holdTicketFixture);
      await contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), 0);
      await expect(
        contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), 0)
      ).to.be.revertedWith("Already listed");
    });

    it("reverts if price is zero", async function () {
      const { contract, buyer1 } = await loadFixture(holdTicketFixture);
      await expect(
        contract.connect(buyer1).listForResale(1, 0, 0)
      ).to.be.revertedWith("Price must be > 0");
    });

    it("reverts when listing an invalidated ticket", async function () {
      const { contract, buyer1, organiser } = await loadFixture(holdTicketFixture);
      await contract.connect(organiser).invalidateTicket(1);
      await expect(
        contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), 0)
      ).to.be.revertedWith("Ticket invalidated");
    });

    it("rejects expiry in the past", async function () {
      const { contract, buyer1 } = await loadFixture(holdTicketFixture);
      const past = (await time.latest()) - 100;
      await expect(
        contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), past)
      ).to.be.revertedWith("expiresAt in the past");
    });

    it("rejects expiry after event date", async function () {
      const { contract, buyer1, future } = await loadFixture(holdTicketFixture);
      await expect(
        contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), future + 10)
      ).to.be.revertedWith("expiresAt after event date");
    });
  });

  // -------------------------------------------------------------------
  // Buy Resale Ticket — royalty split is the core PS#7 mechanic
  // -------------------------------------------------------------------
  describe("buyResaleTicket", function () {
    async function listedFixture() {
      const d = await eventCreatedFixture();
      await d.contract.connect(d.buyer1).buyTicket(0, 0, { value: d.price });
      const resalePrice = ethers.parseEther("1.0");
      await d.contract.connect(d.buyer1).listForResale(1, resalePrice, 0);
      return { ...d, resalePrice };
    }

    it("splits payment 90/10 (royalty 10%) and transfers ownership", async function () {
      const { contract, organiser, buyer1, buyer2, resalePrice } =
        await loadFixture(listedFixture);

      const sellerBefore = await ethers.provider.getBalance(buyer1.address);
      const organiserBefore = await ethers.provider.getBalance(organiser.address);

      await contract.connect(buyer2).buyResaleTicket(1, { value: resalePrice });

      const sellerAfter = await ethers.provider.getBalance(buyer1.address);
      const organiserAfter = await ethers.provider.getBalance(organiser.address);

      const royalty = resalePrice / 10n;
      const sellerAmount = resalePrice - royalty;

      expect(sellerAfter - sellerBefore).to.equal(sellerAmount);
      expect(organiserAfter - organiserBefore).to.equal(royalty);
      expect(await contract.ownerOf(1)).to.equal(buyer2.address);
    });

    it("reverts if seller tries to buy their own listing", async function () {
      const { contract, buyer1, resalePrice } = await loadFixture(listedFixture);
      await expect(
        contract.connect(buyer1).buyResaleTicket(1, { value: resalePrice })
      ).to.be.revertedWith("Cannot buy own listing");
    });

    it("reverts when event is cancelled", async function () {
      const { contract, organiser, buyer2, resalePrice } = await loadFixture(listedFixture);
      await contract.connect(organiser).cancelEvent(0);
      await expect(
        contract.connect(buyer2).buyResaleTicket(1, { value: resalePrice })
      ).to.be.revertedWith("Event cancelled");
    });
  });

  // -------------------------------------------------------------------
  // Royalty Info
  // -------------------------------------------------------------------
  describe("royaltyInfo (EIP-2981)", function () {
    it("returns (organiser, 10% of salePrice)", async function () {
      const { contract, organiser, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      const sale = ethers.parseEther("1.0");
      const [receiver, amount] = await contract.royaltyInfo(1, sale);
      expect(receiver).to.equal(organiser.address);
      expect(amount).to.equal(sale / 10n);
    });
  });

  // -------------------------------------------------------------------
  // Organiser Admin
  // -------------------------------------------------------------------
  describe("Organiser admin", function () {
    it("addTicketsToSection increases supply and emits event", async function () {
      const { contract, organiser } = await loadFixture(eventCreatedFixture);
      await expect(contract.connect(organiser).addTicketsToSection(0, 0, 5))
        .to.emit(contract, "TicketsAddedToSection")
        .withArgs(0, 0, 5, 10, 10);
      const ev = await getEv(contract, 0);
      expect(ev.maxTickets).to.equal(10);
      const sec = await contract.getSection(0, 0);
      expect(sec.maxTickets).to.equal(10);
    });

    it("addTicketsToSection reverts when called by non-organiser", async function () {
      const { contract, buyer1 } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(buyer1).addTicketsToSection(0, 0, 5)
      ).to.be.revertedWith("Caller is not organiser");
    });

    it("addTicketsToSection reverts with amount 0", async function () {
      const { contract, organiser } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(organiser).addTicketsToSection(0, 0, 0)
      ).to.be.revertedWith("amount must be > 0");
    });

    it("addTicketsToSection reverts with invalid section id", async function () {
      const { contract, organiser } = await loadFixture(eventCreatedFixture);
      await expect(
        contract.connect(organiser).addTicketsToSection(0, 42, 5)
      ).to.be.revertedWith("Invalid section");
    });

    it("cancelEvent by organiser blocks further sales", async function () {
      const { contract, organiser } = await loadFixture(eventCreatedFixture);
      await expect(contract.connect(organiser).cancelEvent(0))
        .to.emit(contract, "EventCancelled")
        .withArgs(0, organiser.address);
    });

    it("invalidateTicket by organiser marks ticket invalid and cancels any listing", async function () {
      const { contract, buyer1, organiser, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      await contract.connect(buyer1).listForResale(1, ethers.parseEther("0.15"), 0);

      await expect(contract.connect(organiser).invalidateTicket(1))
        .to.emit(contract, "TicketInvalidated")
        .withArgs(1, organiser.address);

      expect(await contract.isTicketValid(1)).to.equal(false);
      const listing = await contract.getResaleListing(1);
      expect(listing.active).to.equal(false);
    });

    describe("updateEvent", function () {
      it("organiser can change mutable fields before first sale", async function () {
        const { contract, organiser, future } = await loadFixture(eventCreatedFixture);
        const newDate  = future + 3600;

        await expect(
          contract.connect(organiser).updateEvent(
            0,
            METADATA_V2,
            newDate,
            500,   // 5 %
            2
          )
        )
          .to.emit(contract, "EventUpdated")
          .withArgs(0, organiser.address);

        const ev = await getEv(contract, 0);
        expect(ev.metadataURI).to.equal(METADATA_V2);
        expect(ev.royaltyBps).to.equal(500);
        expect(ev.maxPerBuyer).to.equal(2);
        expect(ev.date).to.equal(newDate);
      });

      it("royalty is locked once a ticket is sold", async function () {
        const { contract, organiser, buyer1, price, future } = await loadFixture(
          eventCreatedFixture
        );
        await contract.connect(buyer1).buyTicket(0, 0, { value: price });

        await expect(
          contract.connect(organiser).updateEvent(
            0,
            METADATA,
            future,
            2000,   // different royalty → should revert
            3
          )
        ).to.be.revertedWith("Royalty locked after first sale");
      });

      it("metadata-only updates are allowed after first sale", async function () {
        const { contract, organiser, buyer1, price, royaltyBps, future } =
          await loadFixture(eventCreatedFixture);
        await contract.connect(buyer1).buyTicket(0, 0, { value: price });

        await contract.connect(organiser).updateEvent(
          0,
          METADATA_V2,
          future,
          royaltyBps,
          3
        );
        const ev = await getEv(contract, 0);
        expect(ev.metadataURI).to.equal(METADATA_V2);
      });

      it("rejects empty metadataURI", async function () {
        const { contract, organiser, future } = await loadFixture(eventCreatedFixture);
        await expect(
          contract.connect(organiser).updateEvent(0, "", future, 1000, 3)
        ).to.be.revertedWith("metadataURI required");
      });

      it("reverts for non-organiser", async function () {
        const { contract, buyer1, future } = await loadFixture(eventCreatedFixture);
        await expect(
          contract.connect(buyer1).updateEvent(
            0,
            METADATA,
            future,
            1000,
            3
          )
        ).to.be.revertedWith("Caller is not organiser");
      });
    });
  });

  // -------------------------------------------------------------------
  // View helpers
  // -------------------------------------------------------------------
  describe("View helpers", function () {
    it("getTicketsOfUser returns correct ids", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      const ids = await contract.getTicketsOfUser(buyer1.address);
      expect(ids.map((x) => Number(x))).to.eql([1, 2]);
    });

    it("ticketsBoughtBy reflects per-buyer counter across sections", async function () {
      const { contract, buyer1, sections } = await loadFixture(multiSectionFixture);
      expect(await contract.ticketsBoughtBy(buyer1.address, 0)).to.equal(0);
      await contract.connect(buyer1).buyTicket(0, 0, { value: sections[0].priceWei });
      await contract.connect(buyer1).buyTicket(0, 2, { value: sections[2].priceWei });
      expect(await contract.ticketsBoughtBy(buyer1.address, 0)).to.equal(2);
    });

    it("getEventOfToken returns event data for a token", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      const ev = await contract.getEventOfToken(1);
      expect(ev.metadataURI).to.equal(METADATA);
    });

    it("getSectionOfToken returns the section the ticket belongs to", async function () {
      const { contract, buyer1, sections } = await loadFixture(multiSectionFixture);
      await contract.connect(buyer1).buyTicket(0, 1, { value: sections[1].priceWei });
      const sec = await contract.getSectionOfToken(1);
      expect(sec.priceWei).to.equal(sections[1].priceWei);
    });

    it("getActiveListings reflects additions/removals", async function () {
      const { contract, buyer1, price } = await loadFixture(eventCreatedFixture);
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      await contract.connect(buyer1).buyTicket(0, 0, { value: price });
      await contract.connect(buyer1).listForResale(1, ethers.parseEther("0.1"), 0);
      await contract.connect(buyer1).listForResale(2, ethers.parseEther("0.2"), 0);
      expect((await contract.getActiveListings()).length).to.equal(2);
      await contract.connect(buyer1).cancelResaleListing(1);
      expect((await contract.getActiveListings()).length).to.equal(1);
    });
  });
});
