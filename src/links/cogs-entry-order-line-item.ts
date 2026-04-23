import { defineLink } from "@medusajs/framework/utils";
import ProcurementModule from "../modules/procurement";
import OrderModule from "@medusajs/medusa/order";

/**
 * CogsEntry → order line item. Each fulfilled line can produce
 * multiple CogsEntry rows (one per lot consumed).
 */
export default defineLink(
  {
    linkable: ProcurementModule.linkable.cogsEntry,
    field: "order_line_item_id",
    isList: false,
  },
  OrderModule.linkable.orderLineItem,
  { readOnly: true },
);
