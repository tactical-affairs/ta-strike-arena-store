import { defineLink } from "@medusajs/framework/utils";
import ProcurementModule from "../modules/procurement";
import ProductModule from "@medusajs/medusa/product";

/**
 * A PO line targets exactly one product variant. FK-style link:
 * po_line.variant_id stores the variant id; no join table.
 */
export default defineLink(
  {
    linkable: ProcurementModule.linkable.poLine,
    field: "variant_id",
    isList: false,
  },
  ProductModule.linkable.productVariant,
  { readOnly: true },
);
