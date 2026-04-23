import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { Container, Heading, Table, Text } from "@medusajs/ui";
import type { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types";
import { useEffect, useState } from "react";

type Row = {
  variant_id: string;
  variant_title: string;
  sku: string | null;
  inventory_item_id: string | null;
  active_lots: number;
  qty_on_hand: number;
  weighted_avg_cost: number | null;
  inventory_value: number;
};

/**
 * Product-detail widget showing current cost basis per variant.
 *
 * Pulls each variant's active inventory lots and computes:
 *   - qty_on_hand = sum(qty_remaining)
 *   - weighted_avg_cost = sum(qty_remaining * unit_cost) / sum(qty_remaining)
 *   - inventory_value = sum(qty_remaining * unit_cost)
 *
 * Renders below the standard product details section.
 */
const VariantCostBasisWidget = ({
  data,
}: DetailWidgetProps<AdminProduct>) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!data?.id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/admin/procurement/product-cost-basis?product_id=${data.id}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const json = await res.json();
          setRows(json.rows ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [data?.id]);

  if (loading) return null;
  if (rows.length === 0) return null;

  const totalValue = rows.reduce((s, r) => s + r.inventory_value, 0);

  return (
    <Container className="p-0">
      <div className="px-6 py-4 border-b">
        <Heading level="h2">Cost basis (FIFO)</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Current weighted-average cost per variant. Source of truth is
          individual inventory lots in the Procurement module.
        </Text>
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Variant</Table.HeaderCell>
            <Table.HeaderCell>Qty on hand</Table.HeaderCell>
            <Table.HeaderCell>Active lots</Table.HeaderCell>
            <Table.HeaderCell>Weighted avg cost</Table.HeaderCell>
            <Table.HeaderCell>Inventory value</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((r) => (
            <Table.Row key={r.variant_id}>
              <Table.Cell>
                {r.variant_title}
                {r.sku ? (
                  <span className="text-ui-fg-subtle ml-2">({r.sku})</span>
                ) : null}
              </Table.Cell>
              <Table.Cell>{r.qty_on_hand}</Table.Cell>
              <Table.Cell>{r.active_lots}</Table.Cell>
              <Table.Cell>
                {r.weighted_avg_cost != null
                  ? `$${r.weighted_avg_cost.toFixed(2)}`
                  : "—"}
              </Table.Cell>
              <Table.Cell className="font-mono">
                ${r.inventory_value.toFixed(2)}
              </Table.Cell>
            </Table.Row>
          ))}
          {rows.length > 1 && (
            <Table.Row>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell className="font-medium text-right">Total</Table.Cell>
              <Table.Cell className="font-mono font-medium">
                ${totalValue.toFixed(2)}
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>
    </Container>
  );
};

export const config = defineWidgetConfig({
  zone: "product.details.after",
});

export default VariantCostBasisWidget;
