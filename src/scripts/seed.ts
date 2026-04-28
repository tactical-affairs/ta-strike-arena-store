import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import { ApiKey } from "../../.medusa/types/query-entry-points";
import { bootstrapOpeningBalance } from "./lib/bootstrap-procurement";

// ─── Image source directory ──────────────────────────────────
// Product images are read from the marketing-site repo and uploaded
// via Medusa's File Module (local in dev, S3/R2 in prod).
// Path is resolved from the Medusa project root (process.cwd()).
const MARKETING_IMAGES_DIR = path.resolve(
  process.cwd(),
  "../ta-strike-arena-website/public/images"
);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ─── Product data ────────────────────────────────────────────
// Sourced from ta-strike-arena-website/src/data/shop-products.ts
// Prices in USD (denominated — $125.00 is `125`, $1,283.50 would be `1283.5`).
// Medusa v2 stores amounts as BigNumbers in the currency's main unit; the
// FluidPay payment provider module converts to cents at the API boundary.
//
// ⚠️  BEFORE PRODUCTION SEED: every non-bundle product has a stockQuantity
// value tuned for dev testing (bundle math visible, nothing runs out
// instantly). Replace each `stockQuantity:` with the real starting
// inventory before running this against a prod database. Bundles inherit
// availability from components, so only the 15 non-bundle numbers matter.
// See each `// TODO: replace with real prod starting inventory` marker.

type SeedProduct = {
  title: string;
  handle: string;
  description: string;
  category: string;
  sku: string;
  /** Price in USD (same denomination Medusa stores internally — e.g. `125` = $125.00). */
  price: number;
  images: string[];
  /**
   * Stock on hand for non-bundle products. Bundles leave this undefined;
   * their availability is derived from their components via the inventory kit.
   */
  stockQuantity?: number;
  /**
   * Marks this product as a bundle/kit. When set, `components` must be
   * populated and `stockQuantity` must be omitted — the bundle variant uses
   * an inventory kit that references the component variants' inventory items.
   */
  components?: { sku: string; quantity: number }[];
  /**
   * Optional manufacturer's suggested retail price in USD. When set, it's
   * stored as `variant.metadata.msrp_amount` and the storefront's prebuild
   * sync pulls it to drive "Save $X (Y% off)" copy on product pages.
   */
  msrpAmount?: number;
  /**
   * Packaging footprint for live carrier rates. Populated on non-bundle
   * products only — bundles pass through to component parcels at rate
   * calc time. Values must reflect the actual shipping carton, not the
   * retail box: weight in ounces, dims in inches.
   *
   * ⚠️  BEFORE PRODUCTION SEED: every value below is a rough placeholder.
   * Measure the real packaged product and update. The shipping calculator
   * uses these to build Shippo shipment requests.
   */
  parcel?: {
    weightOz: number;
    lengthIn: number;
    widthIn: number;
    heightIn: number;
  };
  /**
   * Unit cost from supplier. Feeds the opening-balance PO that seeds
   * FIFO inventory lots for each SKU. Defaults to 60% of `price` when
   * unset (rough "typical retailer margin" placeholder).
   *
   * ⚠️  BEFORE PRODUCTION SEED: replace with real supplier costs. COGS
   * reports + gross margin reports depend on these being accurate.
   */
  unitCost?: number;
};

const PRODUCTS: SeedProduct[] = [
  // ─── Targets ───────────────────────────────────────────────
  {
    title: "Home Target",
    handle: "strike-arena-home-target",
    description:
      "The Home Target is the entry point to real performance-based dry fire. Same 7-inch hit zone as our Pro line -- purpose-built for personal training at home. AA batteries mean zero charging downtime: swap and train. Connect via the Strike Arena mobile app (iOS and Android) and you're running timed drills, reactive modes, and multi-target transitions in your garage, basement, or living room. No ammo. No range fees. Just measurable reps that make you faster.",
    category: "Targets",
    sku: "SA.003.01",
    price: 125,
    images: ["/images/strike-arena-target/strike-arena-target-front-yellow.jpg"],
    stockQuantity: 60, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 40, lengthIn: 10, widthIn: 10, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Pro Target",
    handle: "strike-arena-pro-target",
    description:
      "The Pro Target is the full-capability version of the Strike Arena platform. Multi-color LED feedback unlocks color-coded drills, friend-or-foe scenarios, and instructor-led programs that the Home Target can't run. Built-in rechargeable battery rated for 10+ hours means you set up once and train all day -- connect a powerbank for multi-day events. Whether you're running USPSA-style stages at home or deploying 50+ targets across a commercial facility, this is the target serious trainers and range operators build on.",
    category: "Targets",
    sku: "SA.001.01",
    price: 249,
    images: [
      "/images/strike-arena-target/strike-arena-target-front-red.png",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
    stockQuantity: 30, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 56, lengthIn: 14, widthIn: 14, heightIn: 4 }, // TODO: measure actual packaging
  },
  {
    title: "Training Console",
    handle: "strike-arena-training-console",
    description:
      "The Training Console is the brain of every Pro Target setup. It creates a local WiFi network, connects to your Pro targets, and gives you browser-based control from any phone, tablet, or PC. No app downloads. No cloud dependency. Plug it in, open a browser, and you're running drills. Included in every Pro package -- or buy separately if you're adding targets to an existing setup.",
    category: "Targets",
    sku: "SA.002.01",
    price: 264,
    images: [
      "/images/training-console/angle-side.png",
      "/images/training-console/top.png",
      "/images/training-console/ports.png",
    ],
    stockQuantity: 15, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 48, lengthIn: 10, widthIn: 8, heightIn: 4 }, // TODO: measure actual packaging
  },

  // ─── Packages ──────────────────────────────────────────────
  {
    title: "Home Starter Package",
    handle: "strike-arena-home-starter-package",
    description:
      "Everything you need to start training at home, in one box. Three Home Targets controlled by the Strike Arena mobile app (iOS and Android) -- unbox, power on, pair via Bluetooth, and you're running multi-target drills in under 10 minutes. At $297, you save $78 versus buying each target individually. This is the fastest path from \"I want to train more\" to actual measured reps on reactive targets.",
    category: "Packages",
    sku: "SA.004.01",
    price: 297,
    images: ["/images/strike-arena-target/strike-arena-3-target-package-yellow.jpg"],
    components: [{ sku: "SA.003.01", quantity: 3 }],
    msrpAmount: 375,
  },
  {
    title: "Home Premium Package",
    handle: "strike-arena-home-premium-package",
    description:
      "Five Home Targets for the serious home trainer. More targets mean more positions, more complex transitions, and more realistic scenario training. Controlled by the Strike Arena mobile app (iOS and Android) -- pair via Bluetooth and you're running five-target drills in your garage, basement, or living room. At $495, you save $130 versus buying each target individually.",
    category: "Packages",
    sku: "SA.008.01",
    price: 495,
    images: ["/images/strike-arena-target/strike-arena-5-target-package-yellow.jpg"],
    components: [{ sku: "SA.003.01", quantity: 5 }],
    msrpAmount: 625,
  },
  {
    title: "Pro Plus Package",
    handle: "strike-arena-pro-plus-package",
    description:
      "Five Pro Targets and a Training Console -- the setup that unlocks serious multi-target training. Run color-coded drills, timed transitions across five positions, and full scenario modes. Fits comfortably in a home training space or small shooting bay. At $1,283, you save $226 versus individual pricing. Most home trainers who want Pro capability start here.",
    category: "Packages",
    sku: "SA.005.01",
    price: 1283,
    images: [
      "/images/strike-arena-target/strike-arena-5-target-package-red.png",
      "/images/strike-arena-target/strike-arena-5-target-package-rainbow.jpg",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
    components: [
      { sku: "SA.001.01", quantity: 5 },
      { sku: "SA.002.01", quantity: 1 },
    ],
    msrpAmount: 1509,
  },
  {
    title: "Pro Premium Package",
    handle: "strike-arena-pro-premium-package",
    description:
      "Ten Pro Targets and a Training Console for full-bay coverage. Run advanced stages with movement, multiple shooting positions, and complex scenario programming. At $2,286, you save $468 versus buying individually. Ideal for dedicated training spaces, small facilities, or serious competitors who want to build stages that mirror match conditions.",
    category: "Packages",
    sku: "SA.006.01",
    price: 2286,
    images: [
      "/images/strike-arena-target/strike-arena-10-target-package-red.png",
      "/images/strike-arena-target/strike-arena-10-target-package-rainbow.jpg",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
    components: [
      { sku: "SA.001.01", quantity: 10 },
      { sku: "SA.002.01", quantity: 1 },
    ],
    msrpAmount: 2754,
  },

  // ─── Laser Attachments ─────────────────────────────────────
  {
    title: "Laser Ammo Spider Kit",
    handle: "laser-ammo-spider-kit",
    description:
      "The Spider Kit is a rail-mounted IR laser attachment that turns any Picatinny-equipped handgun into a Strike Arena training tool. Mounts in seconds, emits an infrared pulse on trigger pull, and works with every Strike Arena target. Pair it with a KWA ATP-GT (Glock style) or ATP-Z (Sig style) for gas recoil training with automatic trigger reset -- no racking the slide between shots.",
    category: "Laser Attachments",
    sku: "SPDRKIT-IR",
    price: 180,
    images: [
      "/images/la-spider-kit/main.png",
      "/images/la-spider-kit/mounted.png",
      "/images/la-spider-kit/laser.png",
      "/images/la-spider-kit/kit.png",
    ],
    stockQuantity: 25, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 12, lengthIn: 7, widthIn: 5, heightIn: 2 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Flash Kit",
    handle: "laser-ammo-flash-kit",
    description:
      "The Flash Kit is a barrel-attached IR laser for rifles with a 14mm CCW thread. Mount it on a KWA Ronin T10 or any compatible training rifle and you're running full rifle drills on Strike Arena targets -- transitions, movement, and timed stages. IR laser ensures reliable detection across the full range of your training space.",
    category: "Laser Attachments",
    sku: "FLASHKIT-IR",
    price: 200,
    images: [
      "/images/la-flash-kit/main.png",
      "/images/la-flash-kit/mounted.png",
      "/images/la-flash-kit/laser.png",
      "/images/la-flash-kit/kit.png",
    ],
    stockQuantity: 20, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 14, lengthIn: 8, widthIn: 5, heightIn: 2 }, // TODO: measure actual packaging
  },

  // ─── Training Handguns ─────────────────────────────────────
  {
    title: "KWA ATP-GT Training Pistol",
    handle: "atp-gt-training-pistol",
    description:
      "Gas recoil training pistol built on the Glock 17 platform. Realistic trigger pull, blowback action, and automatic trigger reset mean you train reloads, magazine changes, and follow-up shots without ever racking the slide. Requires a Laser Ammo Spider Kit (sold separately) to work with Strike Arena targets. If you want a simpler setup with no separate laser attachment, consider the Laser Ammo Glock 17 with built-in IR laser.",
    category: "Training Handguns",
    sku: "101-00244",
    price: 210,
    images: [
      "/images/kwa-atp-gt/left-1.png",
      "/images/kwa-atp-gt/right-1.png",
      "/images/kwa-atp-gt/left-2.png",
      "/images/kwa-atp-gt/right-2.png",
    ],
    stockQuantity: 15, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 44, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "KWA ATP-Z Training Pistol",
    handle: "atp-z-training-pistol",
    description:
      "Gas recoil training pistol built on the Sig P320 platform. Same blowback action and automatic trigger reset as the ATP-GT, in a Sig-compatible frame. Requires a Laser Ammo Spider Kit (sold separately). For a no-attachment option, consider the Laser Ammo Sig P320/M17 with built-in IR laser.",
    category: "Training Handguns",
    sku: "101-00271",
    price: 210,
    images: [
      "/images/kwa-atp-z/left-1.png",
      "/images/kwa-atp-z/right-1.png",
      "/images/kwa-atp-z/left-2.png",
      "/images/kwa-atp-z/right-2.png",
    ],
    stockQuantity: 15, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 44, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Glock 17 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
    description:
      "Premium training pistol with a built-in IR laser -- no separate attachment needed. Gas recoil, Glock 17 Gen 5 form factor, and automatic trigger reset. Point, shoot, and the target registers the hit. The cleanest setup for handgun training on the Strike Arena platform.",
    category: "Training Handguns",
    sku: "RETP-UG17-GEN5IR",
    price: 470,
    images: [
      "/images/la-glock-17/main.png",
      "/images/la-glock-17/angle.png",
      "/images/la-glock-17/detail.png",
    ],
    stockQuantity: 10, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 48, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Glock 19 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
    description:
      "Same built-in IR laser and gas recoil system as the Glock 17 model, in the compact Glock 19 Gen 5 form factor. Ideal if you carry or compete with a compact frame and want your training reps to match your real firearm's size and balance.",
    category: "Training Handguns",
    sku: "RETP-UG19-GEN5IR",
    price: 470,
    images: [
      "/images/la-glock-19/main.png",
      "/images/la-glock-19/angle.png",
      "/images/la-glock-19/side.png",
      "/images/la-glock-19/detail.png",
    ],
    stockQuantity: 10, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 44, lengthIn: 10, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Glock 45 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
    description:
      "Premium training pistol with a built-in IR laser on the Glock 45 platform. Gas recoil, automatic trigger reset, and the full-size frame preferred by law enforcement and duty carry. Train draws, reloads, and transitions with the same grip and controls as your service weapon.",
    category: "Training Handguns",
    sku: "RETP-UG45-GG-IR",
    price: 470,
    images: [
      "/images/la-glock-45/main.png",
      "/images/la-glock-45/angle.png",
      "/images/la-glock-45/side.png",
      "/images/la-glock-45/detail.png",
    ],
    stockQuantity: 10, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 48, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Sig P320/M17 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
    description:
      "Full-size Sig P320/M17 training pistol with built-in IR laser. Gas recoil, automatic trigger reset, and no separate laser attachment required. Train draws, reloads, and transitions with the same grip angle and controls as your duty or carry weapon.",
    category: "Training Handguns",
    sku: "RETP-SIG-M17-IR",
    price: 480,
    images: [
      "/images/la-sig-m17/main.png",
      "/images/la-sig-m17/angle.png",
      "/images/la-sig-m17/side.png",
      "/images/la-sig-m17/detail.png",
    ],
    stockQuantity: 10, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 48, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo Sig P320/M18 Compact Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-sig-p320-xcarry-m18-compact-training-pistol-green-gas",
    description:
      "Compact Sig P320 XCarry/M18 form factor with built-in IR laser and gas recoil. Same training capability as the full-size M17 model in a shorter, lighter frame. Match your training tool to your carry gun.",
    category: "Training Handguns",
    sku: "RETP-XCARRY-IR",
    price: 480,
    images: [
      "/images/la-sig-m18/main.png",
      "/images/la-sig-m18/angle.png",
      "/images/la-sig-m18/side.png",
    ],
    stockQuantity: 10, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 44, lengthIn: 10, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo CZ Shadow 2 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
    description:
      "Competition-grade CZ Shadow 2 training pistol with built-in IR laser. Gas recoil and the Shadow 2's distinctive trigger feel. Train your competition draws, transitions, and stage plans on Strike Arena targets without burning a single round of match ammo.",
    category: "Training Handguns",
    sku: "RETP-CZS-IR",
    price: 480,
    images: [
      "/images/la-cz-shadow-2/main.png",
      "/images/la-cz-shadow-2/side.png",
      "/images/la-cz-shadow-2/angle.png",
      "/images/la-cz-shadow-2/detail.png",
    ],
    stockQuantity: 8, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 52, lengthIn: 11, widthIn: 7, heightIn: 3 }, // TODO: measure actual packaging
  },
  {
    title: "Laser Ammo 2011 MK Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
    description:
      "AW Custom 2011 MK platform with built-in IR laser and gas recoil. The 2011 grip angle and trigger feel for competition shooters who want their dry fire reps to transfer directly to match day.",
    category: "Training Handguns",
    sku: "RETP-AW2011MK-IR",
    price: 470,
    images: [
      "/images/la-2011-mk/main.png",
      "/images/la-2011-mk/side.png",
      "/images/la-2011-mk/detail.png",
    ],
    stockQuantity: 8, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 56, lengthIn: 12, widthIn: 8, heightIn: 3 }, // TODO: measure actual packaging
  },

  // ─── Training Rifles ───────────────────────────────────────
  {
    title: "KWA Ronin T10 AR-15 Recoil Training Rifle",
    handle: "ronin-t10-etu-aeg-recoil-training-rifle",
    description:
      "Electric recoil training rifle on the AR-15 platform. The ETU (Electronic Trigger Unit) provides a consistent trigger pull with recoil simulation. Requires a Laser Ammo Flash Kit (sold separately) for IR laser capability. Train rifle-to-pistol transitions, room clearing, and carbine drills on Strike Arena targets.",
    category: "Training Rifles",
    sku: "106-01410-ETU",
    price: 470,
    images: [
      "/images/kwa-ronin-t10/left-1.png",
      "/images/kwa-ronin-t10/right-1.png",
      "/images/kwa-ronin-t10/left-2.png",
      "/images/kwa-ronin-t10/detail-1.png",
    ],
    stockQuantity: 12, // TODO: replace with real prod starting inventory
    parcel: { weightOz: 160, lengthIn: 38, widthIn: 12, heightIn: 5 }, // TODO: measure actual packaging
  },

  // ─── Training Kits ─────────────────────────────────────────
  {
    title: "Starter Recoil Training Handgun (Glock Style)",
    handle: "starter-recoil-training-handgun-glock-style",
    description:
      "KWA ATP-GT training pistol (Glock 17 platform) bundled with a Laser Ammo Spider Kit. Gas blowback, automatic trigger reset, and IR laser -- everything you need to add recoil handgun training to your Strike Arena setup. One box, ready to train.",
    category: "Training Kits",
    sku: "SA.101.01",
    price: 390,
    images: [
      "/images/kit-starter-handgun-glock/combined.png",
      "/images/kwa-atp-gt/left-1.png",
      "/images/kit-starter-handgun-glock/spider-kit.png",
    ],
    components: [
      { sku: "101-00244", quantity: 1 },
      { sku: "SPDRKIT-IR", quantity: 1 },
    ],
  },
  {
    title: "Starter Recoil Training Handgun (Sig Style)",
    handle: "starter-recoil-training-handgun-sig-style",
    description:
      "KWA ATP-Z training pistol (Sig P320 platform) bundled with a Laser Ammo Spider Kit. Gas blowback, automatic trigger reset, and IR laser -- everything you need to add recoil handgun training to your Strike Arena setup. One box, ready to train.",
    category: "Training Kits",
    sku: "SA.100.01",
    price: 390,
    images: [
      "/images/kit-starter-handgun-sig/combined.png",
      "/images/kwa-atp-z/left-1.png",
      "/images/kit-starter-handgun-sig/spider-kit.png",
    ],
    components: [
      { sku: "101-00271", quantity: 1 },
      { sku: "SPDRKIT-IR", quantity: 1 },
    ],
  },
  {
    title: "Starter Recoil Training Rifle (AR-15)",
    handle: "starter-recoil-training-rifle-ar-15",
    description:
      "KWA Ronin T10 AR-15 bundled with a Laser Ammo Flash Kit. Electric recoil, IR laser, and everything you need for rifle training on Strike Arena targets. Add carbine drills, rifle-to-pistol transitions, and long-gun stages to your training program.",
    category: "Training Kits",
    sku: "SA.102.01",
    price: 670,
    images: [
      "/images/kit-starter-rifle-ar15/combined.png",
      "/images/kit-starter-rifle-ar15/flash-kit.png",
    ],
    components: [
      { sku: "106-01410-ETU", quantity: 1 },
      { sku: "FLASHKIT-IR", quantity: 1 },
    ],
  },
];

const CATEGORY_NAMES = [
  "Targets",
  "Packages",
  "Laser Attachments",
  "Training Handguns",
  "Training Rifles",
  "Training Kits",
];

// ─── Workflows ───────────────────────────────────────────────

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

// ─── Shipping option builders ────────────────────────────────
//
// The workflow input type (CreateShippingOptionsWorkflowInput) is a
// structural union across flat vs. calculated rows. Narrowing to it in
// the helper signature ties the helpers to Medusa internals and churns
// with upstream type tweaks. The helpers return loose records; the seed
// casts once at the workflow call site via `as never`.

function buildManualShippingOptions(
  serviceZoneId: string,
  shippingProfileId: string,
  regionId: string
): Record<string, unknown>[] {
  const baseRules = [
    { attribute: "enabled_in_store", value: "true", operator: "eq" },
    { attribute: "is_return", value: "false", operator: "eq" },
  ];
  return [
    {
      name: "Standard Shipping",
      price_type: "flat",
      provider_id: "manual_manual",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfileId,
      type: { label: "Standard", description: "Ship in 2-3 days.", code: "standard" },
      prices: [
        { currency_code: "usd", amount: 10 },
        { region_id: regionId, amount: 10 },
      ],
      rules: baseRules,
    },
    {
      name: "Express Shipping",
      price_type: "flat",
      provider_id: "manual_manual",
      service_zone_id: serviceZoneId,
      shipping_profile_id: shippingProfileId,
      type: { label: "Express", description: "Ship in 24 hours.", code: "express" },
      prices: [
        { currency_code: "usd", amount: 25 },
        { region_id: regionId, amount: 25 },
      ],
      rules: baseRules,
    },
  ];
}

// Mirror of SHIPPO_FULFILLMENT_OPTIONS in src/modules/fulfillment-shippo/service.ts.
// Kept as a local list so the seed script doesn't need to import from the
// provider module (which pulls in the Shippo client and its fetch calls).
const SHIPPO_SEED_OPTIONS = [
  {
    id: "usps__ground_advantage",
    carrier: "usps",
    servicelevel: "usps_ground_advantage",
    label: "USPS Ground Advantage",
    code: "usps_ground_advantage",
    description: "USPS Ground Advantage — 2-5 business days.",
  },
  {
    id: "usps__priority",
    carrier: "usps",
    servicelevel: "usps_priority",
    label: "USPS Priority Mail",
    code: "usps_priority",
    description: "USPS Priority Mail — 1-3 business days.",
  },
  {
    id: "ups__ground",
    carrier: "ups",
    servicelevel: "ups_ground",
    label: "UPS Ground",
    code: "ups_ground",
    description: "UPS Ground — 1-5 business days.",
  },
  {
    id: "ups__2nd_day_air",
    carrier: "ups",
    servicelevel: "ups_2nd_day_air",
    label: "UPS 2nd Day Air",
    code: "ups_2nd_day_air",
    description: "UPS 2nd Day Air — 2 business days.",
  },
  {
    id: "fedex__ground",
    carrier: "fedex",
    servicelevel: "fedex_ground",
    label: "FedEx Ground",
    code: "fedex_ground",
    description: "FedEx Ground — 1-5 business days.",
  },
  {
    id: "fedex__2day",
    carrier: "fedex",
    servicelevel: "fedex_2_day",
    label: "FedEx 2Day",
    code: "fedex_2day",
    description: "FedEx 2Day — 2 business days.",
  },
];

function buildShippoShippingOptions(
  serviceZoneId: string,
  shippingProfileId: string,
  regionId: string
): Record<string, unknown>[] {
  const baseRules = [
    { attribute: "enabled_in_store", value: "true", operator: "eq" },
    { attribute: "is_return", value: "false", operator: "eq" },
  ];
  return SHIPPO_SEED_OPTIONS.map((opt) => ({
    name: opt.label,
    price_type: "calculated",
    provider_id: "shippo_shippo",
    service_zone_id: serviceZoneId,
    shipping_profile_id: shippingProfileId,
    type: { label: opt.label, description: opt.description, code: opt.code },
    // Medusa's createShippingOptionsWorkflow still wants `prices` for a
    // calculated option; a zero entry satisfies the schema. The real price
    // comes from the provider's calculatePrice at checkout time.
    prices: [
      { currency_code: "usd", amount: 0 },
      { region_id: regionId, amount: 0 },
    ],
    rules: baseRules,
    data: {
      id: opt.id,
      carrier: opt.carrier,
      servicelevel: opt.servicelevel,
    },
  }));
}

// ─── Seed function ───────────────────────────────────────────

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);
  const fileModuleService = container.resolve(Modules.FILE);

  async function uploadImage(relPath: string): Promise<{ url: string }> {
    const cleanRel = relPath.replace(/^\/?images\//, "");
    const fullPath = path.join(MARKETING_IMAGES_DIR, cleanRel);
    const buffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) {
      throw new Error(`Unsupported image extension: ${ext} (${fullPath})`);
    }
    // Flatten the relative path into the filename so images from different
    // product folders don't collide (many use the same "main.png" basename).
    const flattenedName = cleanRel.replace(/[\/\\]/g, "__");
    const result = await fileModuleService.createFiles({
      filename: flattenedName,
      mimeType,
      content: buffer.toString("base64"),
      access: "public",
    });
    return { url: result.url };
  }

  // ── Store setup ──────────────────────────────────────────

  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
          },
        ],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        {
          currency_code: "usd",
          is_default: true,
        },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });

  // ── Region ───────────────────────────────────────────────

  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "United States",
          currency_code: "usd",
          countries: ["us"],
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  const taxProviderId = process.env.TAXJAR_API_KEY
    ? "tp_taxjar_taxjar"
    : "tp_system";
  await createTaxRegionsWorkflow(container).run({
    input: [
      {
        country_code: "us",
        provider_id: taxProviderId,
      },
    ],
  });
  logger.info(
    `Finished seeding tax regions (provider: ${taxProviderId}).`,
  );

  // ── Stock location ───────────────────────────────────────

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Strike Arena Warehouse",
          address: {
            city: "Redmond",
            country_code: "US",
            province: "Washington",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_location_id: stockLocation.id,
      },
    },
  });

  const providerIds = process.env.SHIPPO_API_KEY
    ? ["manual_manual", "shippo_shippo"]
    : ["manual_manual"];
  for (const providerId of providerIds) {
    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: providerId,
      },
    });
  }

  // ── Fulfillment & shipping ───────────────────────────────

  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Default Shipping Profile",
              type: "default",
            },
          ],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Strike Arena Warehouse delivery",
    type: "shipping",
    service_zones: [
      {
        name: "United States",
        geo_zones: [
          {
            country_code: "us",
            type: "country",
          },
        ],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  const shippingOptionsInput = process.env.SHIPPO_API_KEY
    ? buildShippoShippingOptions(
        fulfillmentSet.service_zones[0].id,
        shippingProfile.id,
        region.id
      )
    : buildManualShippingOptions(
        fulfillmentSet.service_zones[0].id,
        shippingProfile.id,
        region.id
      );

  await createShippingOptionsWorkflow(container).run({
    // Workflow input DTO is a structural union; the helpers build rows in
    // its shape but a cast is the cleanest way to bridge them.
    input: shippingOptionsInput as never,
  });
  logger.info(
    process.env.SHIPPO_API_KEY
      ? "Finished seeding Shippo calculated shipping options."
      : "Finished seeding manual flat shipping options."
  );

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  // ── Publishable API key ──────────────────────────────────

  logger.info("Seeding publishable API key data...");
  let publishableApiKey: ApiKey | null = null;
  const { data } = await query.graph({
    entity: "api_key",
    fields: ["id"],
    filters: {
      type: "publishable",
    },
  });

  publishableApiKey = data?.[0];

  if (!publishableApiKey) {
    const {
      result: [publishableApiKeyResult],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Webshop",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });

    publishableApiKey = publishableApiKeyResult as ApiKey;
  }

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  // ── Product categories ───────────────────────────────────

  logger.info("Seeding product data...");

  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: CATEGORY_NAMES.map((name) => ({
        name,
        is_active: true,
      })),
    },
  });

  // ── Products ─────────────────────────────────────────────

  logger.info(
    `Uploading product images from ${MARKETING_IMAGES_DIR}...`
  );
  const productImagesByHandle = new Map<string, { url: string }[]>();
  for (const p of PRODUCTS) {
    const uploaded = await Promise.all(p.images.map(uploadImage));
    productImagesByHandle.set(p.handle, uploaded);
  }
  logger.info(
    `Uploaded ${Array.from(productImagesByHandle.values()).flat().length} product images.`
  );

  // Bundle products must be created AFTER their components so their
  // inventory kits can reference the components' inventory_items.
  const nonBundles = PRODUCTS.filter((p) => !p.components);
  const bundles = PRODUCTS.filter((p) => !!p.components);

  const makeProductInput = (
    p: SeedProduct,
    extraVariantFields: Record<string, unknown>
  ) => ({
    title: p.title,
    handle: p.handle,
    description: p.description,
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: shippingProfile.id,
    category_ids: [
      categoryResult.find((cat) => cat.name === p.category)!.id,
    ],
    images: productImagesByHandle.get(p.handle)!,
    options: [{ title: "Default", values: ["Default"] }],
    variants: [
      {
        title: "Default",
        sku: p.sku,
        options: { Default: "Default" },
        prices: [{ amount: p.price, currency_code: "usd" }],
        ...(p.msrpAmount != null
          ? { metadata: { msrp_amount: p.msrpAmount } }
          : {}),
        // Parcel dims/weight go on the variant; Medusa propagates them to the
        // auto-created inventory_item, which is what the Shippo fulfillment
        // provider reads at rate-calc time (both for non-bundles and when
        // bundles expand to component parcels via their inventory_items).
        ...(p.parcel
          ? {
              weight: p.parcel.weightOz,
              length: p.parcel.lengthIn,
              width: p.parcel.widthIn,
              height: p.parcel.heightIn,
            }
          : {}),
        ...extraVariantFields,
      },
    ],
    sales_channels: [{ id: defaultSalesChannel[0].id }],
  });

  // Pass 1 — non-bundle products. Medusa auto-creates one inventory_item per variant.
  await createProductsWorkflow(container).run({
    input: {
      products: nonBundles.map((p) =>
        makeProductInput(p, { manage_inventory: true })
      ),
    },
  });
  logger.info(`Seeded ${nonBundles.length} non-bundle products.`);

  // Build SKU → inventory_item_id map from the just-created variants.
  const { data: variantsForKit } = await query.graph({
    entity: "product_variant",
    fields: ["sku", "inventory_items.inventory_item_id"],
    filters: { sku: nonBundles.map((p) => p.sku) },
  });
  const inventoryItemBySku = new Map<string, string>();
  for (const v of variantsForKit as Array<{
    sku: string | null;
    inventory_items: Array<{ inventory_item_id: string }> | null;
  }>) {
    const itemId = v.inventory_items?.[0]?.inventory_item_id;
    if (v.sku && itemId) inventoryItemBySku.set(v.sku, itemId);
  }

  // Derive parcel dims for each bundle by folding over its components:
  // weight = sum of component weights, box dim = max of component dims.
  // This is the "bundle ships as one parcel sized to fit the biggest
  // component" model — simpler than true pass-through and avoids needing
  // cross-module query access from the fulfillment provider.
  const parcelBySku = new Map<string, NonNullable<SeedProduct["parcel"]>>();
  for (const p of nonBundles) {
    if (p.parcel) parcelBySku.set(p.sku, p.parcel);
  }
  for (const b of bundles) {
    let weightOz = 0;
    let lengthIn = 0;
    let widthIn = 0;
    let heightIn = 0;
    for (const c of b.components ?? []) {
      const pc = parcelBySku.get(c.sku);
      if (!pc) {
        throw new Error(
          `Bundle ${b.sku} component ${c.sku} has no parcel data; cannot derive bundle dims`
        );
      }
      weightOz += pc.weightOz * c.quantity;
      lengthIn = Math.max(lengthIn, pc.lengthIn);
      widthIn = Math.max(widthIn, pc.widthIn);
      heightIn = Math.max(heightIn, pc.heightIn);
    }
    b.parcel = { weightOz, lengthIn, widthIn, heightIn };
  }

  // Pass 2 — bundle products. Each variant is an inventory kit of existing inventory_items.
  await createProductsWorkflow(container).run({
    input: {
      products: bundles.map((p) => {
        const kit = p.components!.map((c) => {
          const id = inventoryItemBySku.get(c.sku);
          if (!id) {
            throw new Error(
              `Bundle ${p.sku} references missing component SKU ${c.sku}`
            );
          }
          return { inventory_item_id: id, required_quantity: c.quantity };
        });
        return makeProductInput(p, { inventory_items: kit });
      }),
    },
  });
  logger.info(
    `Seeded ${bundles.length} bundle products via inventory kits.`
  );

  // ── Inventory levels ─────────────────────────────────────
  // Only non-bundle inventory items get levels; bundles inherit from components.

  logger.info("Seeding inventory levels.");

  const stockBySku = new Map(
    nonBundles.map((p) => [p.sku, p.stockQuantity ?? 0])
  );

  const inventoryLevels: CreateInventoryLevelInput[] = [];
  for (const [sku, inventoryItemId] of inventoryItemBySku) {
    inventoryLevels.push({
      location_id: stockLocation.id,
      stocked_quantity: stockBySku.get(sku) ?? 0,
      inventory_item_id: inventoryItemId,
    });
  }

  await createInventoryLevelsWorkflow(container).run({
    input: { inventory_levels: inventoryLevels },
  });

  logger.info("Finished seeding inventory levels data.");

  // ── Procurement: opening-balance PO + FIFO lots ───────────────
  // Bootstrap one demo supplier + one auto-received "opening balance" PO so
  // every non-bundle SKU has FIFO cost layers ready for COGS consumption.
  //
  // Logic lives in bootstrap-procurement.ts and is shared with
  // src/scripts/reset-finalize.ts (the npm run reset flow). If you need to
  // change procurement bootstrap behavior, do it in the helper so both stay
  // in sync.

  logger.info("Seeding procurement: supplier + opening-balance PO.");

  const variantBySku = new Map<string, string>();
  {
    const { data: variantRows } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku"],
    });
    for (const v of variantRows) {
      if (v.sku) variantBySku.set(v.sku, v.id);
    }
  }

  const procurementLines = nonBundles
    .map((p) => {
      const variantId = variantBySku.get(p.sku);
      const inventoryItemId = inventoryItemBySku.get(p.sku);
      if (!variantId || !inventoryItemId) return null;
      const qty = p.stockQuantity ?? 0;
      const unitCost = p.unitCost ?? Math.round(p.price * 0.6 * 100) / 100;
      return {
        variant_id: variantId,
        inventory_item_id: inventoryItemId,
        qty,
        unit_cost: unitCost,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  await bootstrapOpeningBalance({
    container,
    logger,
    stockLocationId: stockLocation.id,
    supplier: {
      name: "Laser Ammo, Inc.",
      contact_name: "Supplier Rep",
      email: "orders@laserammo.example",
      phone: "+1-555-555-0100",
      lead_time_days: 14,
      notes: "Demo seed supplier. Replace with real supplier on first real PO.",
    },
    lines: procurementLines,
  });
}
