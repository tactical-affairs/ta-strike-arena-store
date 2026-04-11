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

// ─── Image URL base ──────────────────────────────────────────
// Dev: ta-strike-arena-website dev server
// Production: change to https://strikearena.net
const IMAGE_BASE = "http://localhost:8000";

// ─── Product data ────────────────────────────────────────────
// Sourced from ta-strike-arena-website/src/data/shop-products.ts
// Prices in cents (USD)

type SeedProduct = {
  title: string;
  handle: string;
  description: string;
  category: string;
  sku: string;
  /** Price in cents */
  price: number;
  images: string[];
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
    price: 12500,
    images: ["/images/strike-arena-target/strike-arena-target-front-yellow.jpg"],
  },
  {
    title: "Pro Target",
    handle: "strike-arena-pro-target",
    description:
      "The Pro Target is the full-capability version of the Strike Arena platform. Multi-color LED feedback unlocks color-coded drills, friend-or-foe scenarios, and instructor-led programs that the Home Target can't run. Built-in rechargeable battery rated for 10+ hours means you set up once and train all day -- connect a powerbank for multi-day events. Whether you're running USPSA-style stages at home or deploying 50+ targets across a commercial facility, this is the target serious trainers and range operators build on.",
    category: "Targets",
    sku: "SA.001.01",
    price: 24900,
    images: [
      "/images/strike-arena-target/strike-arena-target-front-red.png",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
  },
  {
    title: "Training Console",
    handle: "strike-arena-training-console",
    description:
      "The Training Console is the brain of every Pro Target setup. It creates a local WiFi network, connects to your Pro targets, and gives you browser-based control from any phone, tablet, or PC. No app downloads. No cloud dependency. Plug it in, open a browser, and you're running drills. Included in every Pro package -- or buy separately if you're adding targets to an existing setup.",
    category: "Targets",
    sku: "SA.002.01",
    price: 26400,
    images: [
      "/images/training-console/angle-side.png",
      "/images/training-console/top.png",
      "/images/training-console/ports.png",
    ],
  },

  // ─── Packages ──────────────────────────────────────────────
  {
    title: "Home Starter Package",
    handle: "strike-arena-home-starter-package",
    description:
      "Everything you need to start training at home, in one box. Three Home Targets controlled by the Strike Arena mobile app (iOS and Android) -- unbox, power on, pair via Bluetooth, and you're running multi-target drills in under 10 minutes. At $297, you save $78 versus buying each target individually. This is the fastest path from \"I want to train more\" to actual measured reps on reactive targets.",
    category: "Packages",
    sku: "SA.004.01",
    price: 29700,
    images: ["/images/strike-arena-target/strike-arena-3-target-package-yellow.jpg"],
  },
  {
    title: "Home Premium Package",
    handle: "strike-arena-home-premium-package",
    description:
      "Five Home Targets for the serious home trainer. More targets mean more positions, more complex transitions, and more realistic scenario training. Controlled by the Strike Arena mobile app (iOS and Android) -- pair via Bluetooth and you're running five-target drills in your garage, basement, or living room. At $495, you save $130 versus buying each target individually.",
    category: "Packages",
    sku: "SA.008.01",
    price: 49500,
    images: ["/images/strike-arena-target/strike-arena-5-target-package-yellow.jpg"],
  },
  {
    title: "Pro Plus Package",
    handle: "strike-arena-pro-plus-package",
    description:
      "Five Pro Targets and a Training Console -- the setup that unlocks serious multi-target training. Run color-coded drills, timed transitions across five positions, and full scenario modes. Fits comfortably in a home training space or small shooting bay. At $1,283, you save $226 versus individual pricing. Most home trainers who want Pro capability start here.",
    category: "Packages",
    sku: "SA.005.01",
    price: 128300,
    images: [
      "/images/strike-arena-target/strike-arena-5-target-package-red.png",
      "/images/strike-arena-target/strike-arena-5-target-package-rainbow.jpg",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
  },
  {
    title: "Pro Premium Package",
    handle: "strike-arena-pro-premium-package",
    description:
      "Ten Pro Targets and a Training Console for full-bay coverage. Run advanced stages with movement, multiple shooting positions, and complex scenario programming. At $2,286, you save $468 versus buying individually. Ideal for dedicated training spaces, small facilities, or serious competitors who want to build stages that mirror match conditions.",
    category: "Packages",
    sku: "SA.006.01",
    price: 228600,
    images: [
      "/images/strike-arena-target/strike-arena-10-target-package-red.png",
      "/images/strike-arena-target/strike-arena-10-target-package-rainbow.jpg",
      "/images/pro-target/pro-target-front-view.jpg",
      "/images/pro-target/pro-target-angled-view.jpg",
      "/images/pro-target/pro-target-side-view.jpg",
      "/images/pro-target/pro-target-read-view.jpg",
    ],
  },

  // ─── Laser Attachments ─────────────────────────────────────
  {
    title: "Laser Ammo Spider Kit",
    handle: "laser-ammo-spider-kit",
    description:
      "The Spider Kit is a rail-mounted IR laser attachment that turns any Picatinny-equipped handgun into a Strike Arena training tool. Mounts in seconds, emits an infrared pulse on trigger pull, and works with every Strike Arena target. Pair it with a KWA ATP-GT (Glock style) or ATP-Z (Sig style) for gas recoil training with automatic trigger reset -- no racking the slide between shots.",
    category: "Laser Attachments",
    sku: "SPDRKIT-IR",
    price: 18000,
    images: [
      "/images/la-spider-kit/main.png",
      "/images/la-spider-kit/mounted.png",
      "/images/la-spider-kit/laser.png",
      "/images/la-spider-kit/kit.png",
    ],
  },
  {
    title: "Laser Ammo Flash Kit",
    handle: "laser-ammo-flash-kit",
    description:
      "The Flash Kit is a barrel-attached IR laser for rifles with a 14mm CCW thread. Mount it on a KWA Ronin T10 or any compatible training rifle and you're running full rifle drills on Strike Arena targets -- transitions, movement, and timed stages. IR laser ensures reliable detection across the full range of your training space.",
    category: "Laser Attachments",
    sku: "FLASHKIT-IR",
    price: 20000,
    images: [
      "/images/la-flash-kit/main.png",
      "/images/la-flash-kit/mounted.png",
      "/images/la-flash-kit/laser.png",
      "/images/la-flash-kit/kit.png",
    ],
  },

  // ─── Training Handguns ─────────────────────────────────────
  {
    title: "KWA ATP-GT Training Pistol",
    handle: "atp-gt-training-pistol",
    description:
      "Gas recoil training pistol built on the Glock 17 platform. Realistic trigger pull, blowback action, and automatic trigger reset mean you train reloads, magazine changes, and follow-up shots without ever racking the slide. Requires a Laser Ammo Spider Kit (sold separately) to work with Strike Arena targets. If you want a simpler setup with no separate laser attachment, consider the Laser Ammo Glock 17 with built-in IR laser.",
    category: "Training Handguns",
    sku: "101-00244",
    price: 21000,
    images: [
      "/images/kwa-atp-gt/left-1.png",
      "/images/kwa-atp-gt/right-1.png",
      "/images/kwa-atp-gt/left-2.png",
      "/images/kwa-atp-gt/right-2.png",
    ],
  },
  {
    title: "KWA ATP-Z Training Pistol",
    handle: "atp-z-training-pistol",
    description:
      "Gas recoil training pistol built on the Sig P320 platform. Same blowback action and automatic trigger reset as the ATP-GT, in a Sig-compatible frame. Requires a Laser Ammo Spider Kit (sold separately). For a no-attachment option, consider the Laser Ammo Sig P320/M17 with built-in IR laser.",
    category: "Training Handguns",
    sku: "101-00271",
    price: 21000,
    images: [
      "/images/kwa-atp-z/left-1.png",
      "/images/kwa-atp-z/right-1.png",
      "/images/kwa-atp-z/left-2.png",
      "/images/kwa-atp-z/right-2.png",
    ],
  },
  {
    title: "Laser Ammo Glock 17 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
    description:
      "Premium training pistol with a built-in IR laser -- no separate attachment needed. Gas recoil, Glock 17 Gen 5 form factor, and automatic trigger reset. Point, shoot, and the target registers the hit. The cleanest setup for handgun training on the Strike Arena platform.",
    category: "Training Handguns",
    sku: "RETP-UG17-GEN5IR",
    price: 47000,
    images: [
      "/images/la-glock-17/main.png",
      "/images/la-glock-17/angle.png",
      "/images/la-glock-17/detail.png",
    ],
  },
  {
    title: "Laser Ammo Glock 19 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
    description:
      "Same built-in IR laser and gas recoil system as the Glock 17 model, in the compact Glock 19 Gen 5 form factor. Ideal if you carry or compete with a compact frame and want your training reps to match your real firearm's size and balance.",
    category: "Training Handguns",
    sku: "RETP-UG19-GEN5IR",
    price: 47000,
    images: [
      "/images/la-glock-19/main.png",
      "/images/la-glock-19/angle.png",
      "/images/la-glock-19/side.png",
      "/images/la-glock-19/detail.png",
    ],
  },
  {
    title: "Laser Ammo Glock 45 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
    description:
      "Premium training pistol with a built-in IR laser on the Glock 45 platform. Gas recoil, automatic trigger reset, and the full-size frame preferred by law enforcement and duty carry. Train draws, reloads, and transitions with the same grip and controls as your service weapon.",
    category: "Training Handguns",
    sku: "RETP-UG45-GG-IR",
    price: 47000,
    images: [
      "/images/la-glock-45/main.png",
      "/images/la-glock-45/angle.png",
      "/images/la-glock-45/side.png",
      "/images/la-glock-45/detail.png",
    ],
  },
  {
    title: "Laser Ammo Sig P320/M17 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
    description:
      "Full-size Sig P320/M17 training pistol with built-in IR laser. Gas recoil, automatic trigger reset, and no separate laser attachment required. Train draws, reloads, and transitions with the same grip angle and controls as your duty or carry weapon.",
    category: "Training Handguns",
    sku: "RETP-SIG-M17-IR",
    price: 48000,
    images: [
      "/images/la-sig-m17/main.png",
      "/images/la-sig-m17/angle.png",
      "/images/la-sig-m17/side.png",
      "/images/la-sig-m17/detail.png",
    ],
  },
  {
    title: "Laser Ammo Sig P320/M18 Compact Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-sig-p320-xcarry-m18-compact-training-pistol-green-gas",
    description:
      "Compact Sig P320 XCarry/M18 form factor with built-in IR laser and gas recoil. Same training capability as the full-size M17 model in a shorter, lighter frame. Match your training tool to your carry gun.",
    category: "Training Handguns",
    sku: "RETP-XCARRY-IR",
    price: 48000,
    images: [
      "/images/la-sig-m18/main.png",
      "/images/la-sig-m18/angle.png",
      "/images/la-sig-m18/side.png",
    ],
  },
  {
    title: "Laser Ammo CZ Shadow 2 Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
    description:
      "Competition-grade CZ Shadow 2 training pistol with built-in IR laser. Gas recoil and the Shadow 2's distinctive trigger feel. Train your competition draws, transitions, and stage plans on Strike Arena targets without burning a single round of match ammo.",
    category: "Training Handguns",
    sku: "RETP-CZS-IR",
    price: 48000,
    images: [
      "/images/la-cz-shadow-2/main.png",
      "/images/la-cz-shadow-2/side.png",
      "/images/la-cz-shadow-2/angle.png",
      "/images/la-cz-shadow-2/detail.png",
    ],
  },
  {
    title: "Laser Ammo 2011 MK Recoil Training Handgun",
    handle: "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
    description:
      "AW Custom 2011 MK platform with built-in IR laser and gas recoil. The 2011 grip angle and trigger feel for competition shooters who want their dry fire reps to transfer directly to match day.",
    category: "Training Handguns",
    sku: "RETP-AW2011MK-IR",
    price: 47000,
    images: [
      "/images/la-2011-mk/main.png",
      "/images/la-2011-mk/side.png",
      "/images/la-2011-mk/detail.png",
    ],
  },

  // ─── Training Rifles ───────────────────────────────────────
  {
    title: "KWA Ronin T10 AR-15 Recoil Training Rifle",
    handle: "ronin-t10-etu-aeg-recoil-training-rifle",
    description:
      "Electric recoil training rifle on the AR-15 platform. The ETU (Electronic Trigger Unit) provides a consistent trigger pull with recoil simulation. Requires a Laser Ammo Flash Kit (sold separately) for IR laser capability. Train rifle-to-pistol transitions, room clearing, and carbine drills on Strike Arena targets.",
    category: "Training Rifles",
    sku: "106-01410-ETU",
    price: 47000,
    images: [
      "/images/kwa-ronin-t10/left-1.png",
      "/images/kwa-ronin-t10/right-1.png",
      "/images/kwa-ronin-t10/left-2.png",
      "/images/kwa-ronin-t10/detail-1.png",
    ],
  },

  // ─── Training Kits ─────────────────────────────────────────
  {
    title: "Starter Recoil Training Handgun (Glock Style)",
    handle: "starter-recoil-training-handgun-glock-style",
    description:
      "KWA ATP-GT training pistol (Glock 17 platform) bundled with a Laser Ammo Spider Kit. Gas blowback, automatic trigger reset, and IR laser -- everything you need to add recoil handgun training to your Strike Arena setup. One box, ready to train.",
    category: "Training Kits",
    sku: "SA.101.01",
    price: 39000,
    images: [
      "/images/kit-starter-handgun-glock/combined.png",
      "/images/kwa-atp-gt/left-1.png",
      "/images/kit-starter-handgun-glock/spider-kit.png",
    ],
  },
  {
    title: "Starter Recoil Training Handgun (Sig Style)",
    handle: "starter-recoil-training-handgun-sig-style",
    description:
      "KWA ATP-Z training pistol (Sig P320 platform) bundled with a Laser Ammo Spider Kit. Gas blowback, automatic trigger reset, and IR laser -- everything you need to add recoil handgun training to your Strike Arena setup. One box, ready to train.",
    category: "Training Kits",
    sku: "SA.100.01",
    price: 39000,
    images: [
      "/images/kit-starter-handgun-sig/combined.png",
      "/images/kwa-atp-z/left-1.png",
      "/images/kit-starter-handgun-sig/spider-kit.png",
    ],
  },
  {
    title: "Starter Recoil Training Rifle (AR-15)",
    handle: "starter-recoil-training-rifle-ar-15",
    description:
      "KWA Ronin T10 AR-15 bundled with a Laser Ammo Flash Kit. Electric recoil, IR laser, and everything you need for rifle training on Strike Arena targets. Add carbine drills, rifle-to-pistol transitions, and long-gun stages to your training program.",
    category: "Training Kits",
    sku: "SA.102.01",
    price: 67000,
    images: [
      "/images/kit-starter-rifle-ar15/combined.png",
      "/images/kit-starter-rifle-ar15/flash-kit.png",
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

// ─── Seed function ───────────────────────────────────────────

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

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
  await createTaxRegionsWorkflow(container).run({
    input: [
      {
        country_code: "us",
        provider_id: "tp_system",
      },
    ],
  });
  logger.info("Finished seeding tax regions.");

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

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

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

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ship in 2-3 days.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ship in 24 hours.",
          code: "express",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 25,
          },
          {
            region_id: region.id,
            amount: 25,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

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

  await createProductsWorkflow(container).run({
    input: {
      products: PRODUCTS.map((p) => ({
        title: p.title,
        handle: p.handle,
        description: p.description,
        status: ProductStatus.PUBLISHED,
        shipping_profile_id: shippingProfile.id,
        category_ids: [
          categoryResult.find((cat) => cat.name === p.category)!.id,
        ],
        images: p.images.map((path) => ({ url: `${IMAGE_BASE}${path}` })),
        options: [
          {
            title: "Default",
            values: ["Default"],
          },
        ],
        variants: [
          {
            title: "Default",
            sku: p.sku,
            options: {
              Default: "Default",
            },
            prices: [
              {
                amount: p.price,
                currency_code: "usd",
              },
            ],
          },
        ],
        sales_channels: [
          {
            id: defaultSalesChannel[0].id,
          },
        ],
      })),
    },
  });
  logger.info("Finished seeding product data.");

  // ── Inventory levels ─────────────────────────────────────

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = [];
  for (const inventoryItem of inventoryItems) {
    const inventoryLevel = {
      location_id: stockLocation.id,
      stocked_quantity: 1000000,
      inventory_item_id: inventoryItem.id,
    };
    inventoryLevels.push(inventoryLevel);
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  });

  logger.info("Finished seeding inventory levels data.");
}
