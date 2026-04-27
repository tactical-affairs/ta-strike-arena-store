import type { ExecArgs } from "@medusajs/framework/types";
import { PROCUREMENT_MODULE } from "../modules/procurement";
import type ProcurementModuleService from "../modules/procurement/service";

/**
 * Removes the seed-created opening-balance PO and ONLY the inventory lots
 * tied to that PO's lines. Real lots from real receiving events are
 * untouched. Inventory levels themselves (stocked_quantity) are managed via
 * the standard inventory module — zero them via the admin API separately.
 */
export default async function deleteOpeningBalancePO({ container }: ExecArgs) {
  const procurement = container.resolve(PROCUREMENT_MODULE) as ProcurementModuleService & {
    softDeletePurchaseOrders: (ids: string[]) => Promise<unknown>;
    softDeleteInventoryLots: (ids: string[]) => Promise<unknown>;
  };

  // Find the seed PO — may already be soft-deleted, so include withDeleted
  const pos = await procurement.listPurchaseOrders(
    { po_number: "PO-OPENING-BALANCE" },
    { relations: ["lines"], withDeleted: true } as never,
  );
  if (pos.length === 0) {
    console.log("[cleanup] No PO-OPENING-BALANCE found.");
    return;
  }

  for (const po of pos) {
    const lineIds = (po.lines ?? []).map((l: { id: string }) => l.id);
    console.log(`[cleanup] PO ${po.po_number} (${po.id}) has ${lineIds.length} lines`);

    if (lineIds.length > 0) {
      // Match lots by FK to this specific PO's lines only — never touches
      // lots from any other PO.
      const lots = await procurement.listInventoryLots(
        { po_line_id: lineIds },
        {},
      );
      if (lots.length > 0) {
        console.log(`[cleanup] Soft-deleting ${lots.length} lots tied to ${po.po_number}`);
        await procurement.softDeleteInventoryLots(lots.map((l: { id: string }) => l.id));
      } else {
        console.log(`[cleanup] No active lots remain for ${po.po_number}`);
      }
    }

    if (!po.deleted_at) {
      console.log(`[cleanup] Soft-deleting PO ${po.id}`);
      await procurement.softDeletePurchaseOrders([po.id]);
    } else {
      console.log(`[cleanup] PO ${po.id} already soft-deleted (${po.deleted_at.toISOString?.() ?? po.deleted_at})`);
    }
  }
}
