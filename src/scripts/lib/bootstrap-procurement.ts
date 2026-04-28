/**
 * Shared procurement bootstrap: creates one supplier and one auto-received
 * "opening balance" purchase order whose lines feed the FIFO inventory_lots
 * for each provided variant. Used by:
 *
 *   - src/scripts/seed.ts                 (one-time bootstrap of a brand-new env)
 *   - src/scripts/reset-finalize.ts       (every `npm run reset` from prod cache)
 *
 * Both callers compute their own `lines` array — seed.ts uses its hardcoded
 * SeedProduct list, reset queries the just-restored DB. Keeping line
 * computation in the caller lets each one apply its own policy (seed has
 * per-product `unitCost` overrides; reset uses a flat 0.6 × price).
 *
 * If you're tempted to fork this logic in either caller — don't. The two flows
 * MUST stay in sync, otherwise dev resets won't match the procurement state
 * that seed.ts produces in fresh environments. Add new behavior here so both
 * benefit.
 */

import type { MedusaContainer } from "@medusajs/framework/types";
import { PROCUREMENT_MODULE } from "../../modules/procurement";

export type ProcurementSeedLine = {
  /** Medusa variant ID (variant_xxx). */
  variant_id: string;
  /** Inventory item ID that this variant directly owns (`inventory_item.sku === variant.sku`). */
  inventory_item_id: string;
  /** Quantity to order + receive. Skipped if <= 0. */
  qty: number;
  /** Per-unit cost in the main currency unit (e.g. dollars, not cents). */
  unit_cost: number;
};

export type SupplierInput = {
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  default_currency?: string;
  lead_time_days?: number;
  notes?: string;
};

type ProcurementService = {
  createSuppliers: (input: Record<string, unknown>) => Promise<{ id: string }>;
  createPurchaseOrderWithLines: (input: {
    supplier_id: string;
    po_number?: string;
    ordered_at?: Date;
    notes?: string;
    lines: Array<{ variant_id: string; qty_ordered: number; unit_cost: number }>;
  }) => Promise<{ id: string }>;
  retrievePurchaseOrder: (
    id: string,
    cfg: { relations: string[] },
  ) => Promise<{
    id: string;
    lines: Array<{ id: string; variant_id: string; qty_ordered: number }>;
  }>;
  receivePurchaseOrder: (input: {
    purchase_order_id: string;
    location_id: string;
    received_at?: Date;
    lines: Array<{
      po_line_id: string;
      inventory_item_id: string;
      qty_received: number;
    }>;
  }) => Promise<{ lots_created: string[]; po_status: string }>;
};

export type BootstrapResult = {
  supplierId: string;
  poId: string | null;
  lotsCreated: number;
};

/**
 * Idempotency note: this function does NOT check for existing data. Callers
 * are responsible for running it against a clean state (post-truncate or
 * fresh DB). Running twice will create duplicate suppliers and POs.
 */
export async function bootstrapOpeningBalance({
  container,
  logger,
  stockLocationId,
  supplier,
  lines,
  poNumber = "PO-OPENING-BALANCE",
  notes = "Opening balance. Replace with real historical PO data in prod.",
}: {
  container: MedusaContainer;
  logger?: { info: (m: string) => void };
  stockLocationId: string;
  supplier: SupplierInput;
  lines: ProcurementSeedLine[];
  poNumber?: string;
  notes?: string;
}): Promise<BootstrapResult> {
  const procurement = container.resolve(PROCUREMENT_MODULE) as unknown as ProcurementService;
  // Medusa's logger uses `this` internally; extract via a bound wrapper so
  // the bare `log("...")` call below doesn't lose the receiver.
  const log = logger ? (m: string) => logger.info(m) : () => {};

  log("[procurement] Creating demo supplier.");
  const createdSupplier = await procurement.createSuppliers({
    name: supplier.name,
    contact_name: supplier.contact_name,
    email: supplier.email,
    phone: supplier.phone,
    default_currency: supplier.default_currency ?? "usd",
    lead_time_days: supplier.lead_time_days ?? 14,
    notes: supplier.notes,
  });

  const usableLines = lines.filter((l) => l.qty > 0);
  if (usableLines.length === 0) {
    log("[procurement] No lines with qty > 0; supplier created but no PO.");
    return { supplierId: createdSupplier.id, poId: null, lotsCreated: 0 };
  }

  log(`[procurement] Creating opening-balance PO with ${usableLines.length} lines.`);
  const { id: poId } = await procurement.createPurchaseOrderWithLines({
    supplier_id: createdSupplier.id,
    po_number: poNumber,
    ordered_at: new Date(),
    notes,
    lines: usableLines.map((l) => ({
      variant_id: l.variant_id,
      qty_ordered: l.qty,
      unit_cost: l.unit_cost,
    })),
  });

  const poDetail = await procurement.retrievePurchaseOrder(poId, {
    relations: ["lines"],
  });

  // Match each PO line back to its caller-provided inventory_item_id via variant_id.
  const inventoryItemByVariantId = new Map(
    usableLines.map((l) => [l.variant_id, l.inventory_item_id]),
  );

  const receiveLines = poDetail.lines
    .map((line) => {
      const inventoryItemId = inventoryItemByVariantId.get(line.variant_id);
      if (!inventoryItemId) return null;
      return {
        po_line_id: line.id,
        inventory_item_id: inventoryItemId,
        qty_received: line.qty_ordered,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const result = await procurement.receivePurchaseOrder({
    purchase_order_id: poId,
    location_id: stockLocationId,
    received_at: new Date(),
    lines: receiveLines,
  });

  log(
    `[procurement] Received PO ${poId}: ${result.lots_created.length} lots created, status=${result.po_status}.`,
  );

  return {
    supplierId: createdSupplier.id,
    poId,
    lotsCreated: result.lots_created.length,
  };
}
