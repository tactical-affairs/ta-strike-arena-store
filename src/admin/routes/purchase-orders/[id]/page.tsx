import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Table,
  Text,
  Drawer,
} from "@medusajs/ui";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

type Line = {
  id: string;
  variant_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: string | number;
  currency: string;
};

type Adjustment = {
  id: string;
  type: "shipping" | "discount" | "tariff" | "other";
  amount: string | number;
  notes: string | null;
};

type PurchaseOrder = {
  id: string;
  po_number: string;
  status: string;
  ordered_at: string | null;
  expected_at: string | null;
  notes: string | null;
  supplier: { id: string; name: string } | null;
  lines: Line[];
  adjustments: Adjustment[];
};

type LandedCosts = Record<string, { landed_unit_cost: number; allocated: number }>;

type Location = { id: string; name: string };

const STATUS_COLORS: Record<string, "grey" | "blue" | "orange" | "green" | "red"> = {
  draft: "grey",
  submitted: "blue",
  partial: "orange",
  closed: "green",
  canceled: "red",
};

const PurchaseOrderDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [landedCosts, setLandedCosts] = useState<LandedCosts>({});
  const [loading, setLoading] = useState(true);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [newAdj, setNewAdj] = useState<{
    type: Adjustment["type"];
    amount: string;
    notes: string;
  }>({ type: "shipping", amount: "", notes: "" });
  const [adjBusy, setAdjBusy] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/admin/procurement/purchase-orders/${id}`, {
        credentials: "include",
      });
      const data = await res.json();
      setPo(data.purchase_order ?? null);
      setLandedCosts(data.landed_costs ?? {});
    } finally {
      setLoading(false);
    }
  };

  const addAdjustment = async () => {
    if (!id) return;
    const amt = parseFloat(newAdj.amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    const signed = newAdj.type === "discount" ? -Math.abs(amt) : amt;
    setAdjBusy(true);
    try {
      await fetch(
        `/admin/procurement/purchase-orders/${id}/adjustments`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: newAdj.type,
            amount: signed,
            notes: newAdj.notes || undefined,
          }),
        },
      );
      setNewAdj({ type: "shipping", amount: "", notes: "" });
      await load();
    } finally {
      setAdjBusy(false);
    }
  };

  const removeAdjustment = async (adjustmentId: string) => {
    if (!id) return;
    await fetch(
      `/admin/procurement/purchase-orders/${id}/adjustments?adjustment_id=${adjustmentId}`,
      { method: "DELETE", credentials: "include" },
    );
    await load();
  };

  useEffect(() => {
    load();
  }, [id]);

  if (loading) return <Container className="p-6">Loading…</Container>;
  if (!po) return <Container className="p-6">Not found.</Container>;

  const canReceive = po.status !== "closed" && po.status !== "canceled";
  const totalValue = po.lines.reduce(
    (s, l) => s + l.qty_ordered * Number(l.unit_cost),
    0,
  );

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <div className="flex items-center gap-3">
            <Link
              to="/purchase-orders"
              className="text-ui-fg-subtle hover:text-ui-fg-base"
            >
              ← Purchase Orders
            </Link>
            <Heading level="h2">{po.po_number}</Heading>
            <Badge color={STATUS_COLORS[po.status] ?? "grey"}>
              {po.status}
            </Badge>
          </div>
          <Text size="small" className="text-ui-fg-subtle">
            {po.supplier?.name ?? "No supplier"} ·
            {po.ordered_at
              ? ` Ordered ${new Date(po.ordered_at).toLocaleDateString()}`
              : " Not ordered"}
            {po.expected_at
              ? ` · Expected ${new Date(po.expected_at).toLocaleDateString()}`
              : ""}
          </Text>
        </div>
        {canReceive && (
          <Button onClick={() => setReceiveOpen(true)}>Receive items</Button>
        )}
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Variant</Table.HeaderCell>
            <Table.HeaderCell>Ordered</Table.HeaderCell>
            <Table.HeaderCell>Received</Table.HeaderCell>
            <Table.HeaderCell>Unit cost</Table.HeaderCell>
            <Table.HeaderCell>Landed unit cost</Table.HeaderCell>
            <Table.HeaderCell>Line total</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {po.lines.map((l) => {
            const landed = landedCosts[l.id];
            const landedCost = landed?.landed_unit_cost ?? Number(l.unit_cost);
            const delta = landedCost - Number(l.unit_cost);
            return (
              <Table.Row key={l.id}>
                <Table.Cell className="font-mono text-ui-fg-subtle text-xs">
                  {l.variant_id}
                </Table.Cell>
                <Table.Cell>{l.qty_ordered}</Table.Cell>
                <Table.Cell>
                  {l.qty_received}
                  {l.qty_received >= l.qty_ordered ? " ✓" : ""}
                </Table.Cell>
                <Table.Cell>${Number(l.unit_cost).toFixed(2)}</Table.Cell>
                <Table.Cell>
                  <span className={delta !== 0 ? "font-medium" : ""}>
                    ${landedCost.toFixed(2)}
                  </span>
                  {delta !== 0 && (
                    <span
                      className={`ml-1 text-xs ${delta > 0 ? "text-ui-fg-subtle" : "text-ui-fg-interactive"}`}
                    >
                      ({delta > 0 ? "+" : ""}${delta.toFixed(2)})
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  ${(l.qty_ordered * Number(l.unit_cost)).toFixed(2)}
                </Table.Cell>
              </Table.Row>
            );
          })}
          <Table.Row>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell className="font-medium text-right">PO total</Table.Cell>
            <Table.Cell className="font-mono font-medium">
              ${totalValue.toFixed(2)}
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>

      {/* Adjustments */}
      <div className="px-6 py-4 border-t space-y-3">
        <div>
          <Label>Adjustments (shipping, discount, tariff, other)</Label>
          <Text size="small" className="text-ui-fg-subtle">
            Allocated across lines by extended value and baked into the landed unit cost.
            Edits only affect lots received after the change — earlier lots keep their original cost.
          </Text>
        </div>
        {po.adjustments?.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Notes</Table.HeaderCell>
                <Table.HeaderCell></Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {po.adjustments.map((a) => {
                const amt = Number(a.amount);
                return (
                  <Table.Row key={a.id}>
                    <Table.Cell className="capitalize">{a.type}</Table.Cell>
                    <Table.Cell className={amt < 0 ? "text-ui-fg-error" : ""}>
                      {amt < 0 ? "−" : ""}${Math.abs(amt).toFixed(2)}
                    </Table.Cell>
                    <Table.Cell>{a.notes || "—"}</Table.Cell>
                    <Table.Cell>
                      <Button
                        variant="transparent"
                        size="small"
                        onClick={() => removeAdjustment(a.id)}
                      >
                        ×
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <Select
              value={newAdj.type}
              onValueChange={(v) =>
                setNewAdj({ ...newAdj, type: v as Adjustment["type"] })
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="shipping">Shipping</Select.Item>
                <Select.Item value="discount">Discount</Select.Item>
                <Select.Item value="tariff">Tariff / duty</Select.Item>
                <Select.Item value="other">Other</Select.Item>
              </Select.Content>
            </Select>
          </div>
          <div className="col-span-3">
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={newAdj.amount}
              onChange={(e) =>
                setNewAdj({ ...newAdj, amount: e.target.value })
              }
            />
          </div>
          <div className="col-span-5">
            <Input
              placeholder="Notes (optional)"
              value={newAdj.notes}
              onChange={(e) =>
                setNewAdj({ ...newAdj, notes: e.target.value })
              }
            />
          </div>
          <div className="col-span-1">
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={addAdjustment}
              disabled={!newAdj.amount || adjBusy}
            >
              {adjBusy ? "…" : "Add"}
            </Button>
          </div>
        </div>
      </div>

      {po.notes && (
        <div className="px-6 py-4 border-t">
          <Label>Notes</Label>
          <Text>{po.notes}</Text>
        </div>
      )}

      <ReceiveDrawer
        po={po}
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        onReceived={() => {
          setReceiveOpen(false);
          load();
        }}
      />
    </Container>
  );
};

function ReceiveDrawer({
  po,
  open,
  onClose,
  onReceived,
}: {
  po: PurchaseOrder;
  open: boolean;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [inventoryItemIds, setInventoryItemIds] = useState<
    Record<string, string>
  >({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const locRes = await fetch(
        "/admin/stock-locations?fields=id,name",
        { credentials: "include" },
      );
      const locData = await locRes.json();
      setLocations(locData.stock_locations ?? []);
      if (locData.stock_locations?.length === 1) {
        setLocationId(locData.stock_locations[0].id);
      }

      // Look up inventory_item_id for each variant on the PO
      const variantIds = po.lines.map((l) => l.variant_id).filter(Boolean);
      if (variantIds.length > 0) {
        const params = new URLSearchParams({
          id: variantIds.join(","),
          fields: "id,inventory_items.inventory.id",
        });
        const varRes = await fetch(
          `/admin/products/variants?${params.toString()}`,
          { credentials: "include" },
        );
        const varData = await varRes.json();
        const map: Record<string, string> = {};
        for (const v of varData.variants ?? []) {
          const invItem = v.inventory_items?.[0]?.inventory?.id;
          if (invItem) map[v.id] = invItem;
        }
        setInventoryItemIds(map);
      }
    })();
  }, [open, po.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) {
      setError("Pick a location");
      return;
    }
    const lines = po.lines
      .map((l) => ({
        po_line_id: l.id,
        inventory_item_id: inventoryItemIds[l.variant_id],
        qty_received: parseInt(receiveQty[l.id] ?? "0", 10),
      }))
      .filter((l) => l.qty_received > 0);

    if (lines.length === 0) {
      setError("Enter at least one quantity to receive");
      return;
    }

    const missingInv = lines.find((l) => !l.inventory_item_id);
    if (missingInv) {
      setError(
        `Couldn't find inventory item for a line — check the variant has inventory tracking enabled`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/admin/procurement/purchase-orders/${po.id}/receive`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location_id: locationId,
            received_at: new Date().toISOString(),
            lines,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setReceiveQty({});
      onReceived();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Receive {po.po_number}</Drawer.Title>
        </Drawer.Header>
        <form onSubmit={handleSubmit}>
          <Drawer.Body className="space-y-4">
            <div>
              <Label>Receive at *</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <Select.Trigger>
                  <Select.Value placeholder="Warehouse" />
                </Select.Trigger>
                <Select.Content>
                  {locations.map((l) => (
                    <Select.Item key={l.id} value={l.id}>
                      {l.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Variant</Table.HeaderCell>
                  <Table.HeaderCell>Outstanding</Table.HeaderCell>
                  <Table.HeaderCell>Receive now</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {po.lines.map((l) => {
                  const outstanding = l.qty_ordered - l.qty_received;
                  return (
                    <Table.Row key={l.id}>
                      <Table.Cell className="font-mono text-xs">
                        {l.variant_id}
                      </Table.Cell>
                      <Table.Cell>{outstanding}</Table.Cell>
                      <Table.Cell>
                        <Input
                          type="number"
                          min="0"
                          max={outstanding}
                          value={receiveQty[l.id] ?? ""}
                          onChange={(e) =>
                            setReceiveQty({
                              ...receiveQty,
                              [l.id]: e.target.value,
                            })
                          }
                          disabled={outstanding === 0}
                          placeholder="0"
                        />
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>

            {error && <Text className="text-ui-fg-error">{error}</Text>}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </Drawer.Close>
            <Button type="submit" disabled={saving || !locationId}>
              {saving ? "Receiving…" : "Record receipt"}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  );
}

export const config = defineRouteConfig({
  label: "", // hidden from sidebar — only reachable via PO list links
});

export default PurchaseOrderDetailPage;
