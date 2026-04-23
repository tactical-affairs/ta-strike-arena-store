import { defineLink } from "@medusajs/framework/utils";
import ProcurementModule from "../modules/procurement";
import InventoryModule from "@medusajs/medusa/inventory";

/**
 * Every FIFO lot belongs to exactly one core inventory_item
 * (what Medusa tracks stocked_quantity on). The receive workflow
 * bumps inventory_level.stocked_quantity separately via the
 * inventory module service.
 */
export default defineLink(
  {
    linkable: ProcurementModule.linkable.inventoryLot,
    field: "inventory_item_id",
    isList: false,
  },
  InventoryModule.linkable.inventoryItem,
  { readOnly: true },
);
