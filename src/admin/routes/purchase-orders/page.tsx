import { defineRouteConfig } from "@medusajs/admin-sdk";
import { DocumentText } from "@medusajs/icons";
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
} from "@medusajs/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreatePurchaseOrderDrawer } from "./create-drawer";

type PurchaseOrder = {
  id: string;
  po_number: string;
  status: string;
  ordered_at: string | null;
  expected_at: string | null;
  supplier: { id: string; name: string } | null;
  lines: Array<{
    id: string;
    qty_ordered: number;
    qty_received: number;
    unit_cost: string | number;
    variant_id: string;
  }> | null;
};

const STATUS_COLORS: Record<string, "grey" | "blue" | "orange" | "green" | "red"> = {
  draft: "grey",
  submitted: "blue",
  partial: "orange",
  closed: "green",
  canceled: "red",
};

const PurchaseOrdersPage = () => {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/admin/procurement/purchase-orders", {
        credentials: "include",
      });
      const data = await res.json();
      setPos(data.purchase_orders ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <Heading level="h2">Purchase Orders</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Inventory received at supplier cost, tracked in FIFO lots.
          </Text>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>New purchase order</Button>
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>PO #</Table.HeaderCell>
            <Table.HeaderCell>Supplier</Table.HeaderCell>
            <Table.HeaderCell>Status</Table.HeaderCell>
            <Table.HeaderCell>Lines</Table.HeaderCell>
            <Table.HeaderCell>Total qty</Table.HeaderCell>
            <Table.HeaderCell>Ordered</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell>Loading…</Table.Cell>
            </Table.Row>
          ) : pos.length === 0 ? (
            <Table.Row>
              <Table.Cell>
                <Text className="text-ui-fg-subtle">
                  No purchase orders yet.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            pos.map((po) => {
              const totalOrdered = (po.lines ?? []).reduce(
                (s, l) => s + l.qty_ordered,
                0,
              );
              const totalReceived = (po.lines ?? []).reduce(
                (s, l) => s + l.qty_received,
                0,
              );
              return (
                <Table.Row key={po.id}>
                  <Table.Cell>
                    <Link
                      to={`/purchase-orders/${po.id}`}
                      className="text-ui-fg-interactive font-medium hover:underline"
                    >
                      {po.po_number}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>{po.supplier?.name ?? "—"}</Table.Cell>
                  <Table.Cell>
                    <Badge color={STATUS_COLORS[po.status] ?? "grey"}>
                      {po.status}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{po.lines?.length ?? 0}</Table.Cell>
                  <Table.Cell>
                    {totalReceived} / {totalOrdered}
                  </Table.Cell>
                  <Table.Cell>
                    {po.ordered_at
                      ? new Date(po.ordered_at).toLocaleDateString()
                      : "—"}
                  </Table.Cell>
                </Table.Row>
              );
            })
          )}
        </Table.Body>
      </Table>

      <CreatePurchaseOrderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={() => {
          setDrawerOpen(false);
          load();
        }}
      />
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Purchase Orders",
  icon: DocumentText,
});

export default PurchaseOrdersPage;
