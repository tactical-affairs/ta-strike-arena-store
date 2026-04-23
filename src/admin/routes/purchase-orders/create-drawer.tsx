import {
  Button,
  Drawer,
  Input,
  Label,
  Select,
  Table,
  Text,
} from "@medusajs/ui";
import { useEffect, useState } from "react";

type Supplier = { id: string; name: string };

type Variant = {
  id: string;
  sku: string | null;
  title: string;
  product: { title: string } | null;
};

type Line = {
  variant_id: string;
  variant_label: string;
  qty_ordered: number;
  unit_cost: number;
};

type Adjustment = {
  type: "shipping" | "discount" | "tariff" | "other";
  amount: number;
  notes: string;
};

export function CreatePurchaseOrderDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [lines, setLines] = useState<Line[]>([]);
  const [newLine, setNewLine] = useState({
    variant_id: "",
    qty: "",
    unit_cost: "",
  });
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [newAdj, setNewAdj] = useState<{
    type: Adjustment["type"];
    amount: string;
    notes: string;
  }>({
    type: "shipping",
    amount: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const [supRes, varRes] = await Promise.all([
        fetch("/admin/procurement/suppliers", { credentials: "include" }),
        fetch(
          "/admin/products?limit=100&fields=id,title,variants.id,variants.sku,variants.title",
          { credentials: "include" },
        ),
      ]);
      const supData = await supRes.json();
      const varData = await varRes.json();
      setSuppliers(supData.suppliers ?? []);
      const flat: Variant[] = [];
      for (const p of varData.products ?? []) {
        for (const v of p.variants ?? []) {
          flat.push({
            id: v.id,
            sku: v.sku,
            title: v.title,
            product: { title: p.title },
          });
        }
      }
      setVariants(flat);
    })();
  }, [open]);

  const addLine = () => {
    const v = variants.find((x) => x.id === newLine.variant_id);
    if (!v) return;
    const qty = parseInt(newLine.qty, 10);
    const unit_cost = parseFloat(newLine.unit_cost);
    if (!qty || qty <= 0 || !unit_cost || unit_cost <= 0) return;
    setLines([
      ...lines,
      {
        variant_id: v.id,
        variant_label: `${v.product?.title ?? ""} — ${v.title}${v.sku ? ` (${v.sku})` : ""}`,
        qty_ordered: qty,
        unit_cost,
      },
    ]);
    setNewLine({ variant_id: "", qty: "", unit_cost: "" });
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const addAdjustment = () => {
    const amt = parseFloat(newAdj.amount);
    if (!Number.isFinite(amt) || amt === 0) return;
    // Discounts are stored negative; the UI shows a positive value and flips.
    const signed = newAdj.type === "discount" ? -Math.abs(amt) : amt;
    setAdjustments([
      ...adjustments,
      {
        type: newAdj.type,
        amount: signed,
        notes: newAdj.notes,
      },
    ]);
    setNewAdj({ type: "shipping", amount: "", notes: "" });
  };

  const removeAdjustment = (idx: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || lines.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/admin/procurement/purchase-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          expected_at: expectedAt || undefined,
          notes: notes || undefined,
          ordered_at: new Date().toISOString(),
          lines: lines.map((l) => ({
            variant_id: l.variant_id,
            qty_ordered: l.qty_ordered,
            unit_cost: l.unit_cost,
          })),
          adjustments: adjustments.length
            ? adjustments.map((a) => ({
                type: a.type,
                amount: a.amount,
                notes: a.notes || undefined,
              }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setSupplierId("");
      setExpectedAt("");
      setNotes("");
      setLines([]);
      setAdjustments([]);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const lineTotal = lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0);
  const adjustmentTotal = adjustments.reduce((s, a) => s + a.amount, 0);
  const total = lineTotal + adjustmentTotal;

  return (
    <Drawer open={open} onOpenChange={onClose}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>New purchase order</Drawer.Title>
        </Drawer.Header>
        <form onSubmit={handleSubmit}>
          <Drawer.Body className="space-y-4">
            <div>
              <Label>Supplier *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <Select.Trigger>
                  <Select.Value placeholder="Choose supplier" />
                </Select.Trigger>
                <Select.Content>
                  {suppliers.map((s) => (
                    <Select.Item key={s.id} value={s.id}>
                      {s.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label>Expected delivery</Label>
              <Input
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label>Line items *</Label>
              {lines.length > 0 && (
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Item</Table.HeaderCell>
                      <Table.HeaderCell>Qty</Table.HeaderCell>
                      <Table.HeaderCell>Unit cost</Table.HeaderCell>
                      <Table.HeaderCell>Subtotal</Table.HeaderCell>
                      <Table.HeaderCell></Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {lines.map((l, i) => (
                      <Table.Row key={i}>
                        <Table.Cell>{l.variant_label}</Table.Cell>
                        <Table.Cell>{l.qty_ordered}</Table.Cell>
                        <Table.Cell>${l.unit_cost.toFixed(2)}</Table.Cell>
                        <Table.Cell>
                          ${(l.qty_ordered * l.unit_cost).toFixed(2)}
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            variant="transparent"
                            size="small"
                            onClick={() => removeLine(i)}
                            type="button"
                          >
                            ×
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}

              <div className="grid grid-cols-12 gap-2 items-end pt-2">
                <div className="col-span-6">
                  <Select
                    value={newLine.variant_id}
                    onValueChange={(v) =>
                      setNewLine({ ...newLine, variant_id: v })
                    }
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Choose variant" />
                    </Select.Trigger>
                    <Select.Content>
                      {variants.map((v) => (
                        <Select.Item key={v.id} value={v.id}>
                          {v.product?.title} — {v.title}
                          {v.sku ? ` (${v.sku})` : ""}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={newLine.qty}
                    onChange={(e) =>
                      setNewLine({ ...newLine, qty: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit cost"
                    value={newLine.unit_cost}
                    onChange={(e) =>
                      setNewLine({ ...newLine, unit_cost: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-1">
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    onClick={addLine}
                    disabled={
                      !newLine.variant_id ||
                      !newLine.qty ||
                      !newLine.unit_cost
                    }
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label>Adjustments (shipping, discounts, tariffs)</Label>
              <Text size="small" className="text-ui-fg-subtle">
                Adjustments are allocated across lines by extended value
                and baked into each lot's landed cost. Discounts reduce cost.
              </Text>
              {adjustments.length > 0 && (
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
                    {adjustments.map((a, i) => (
                      <Table.Row key={i}>
                        <Table.Cell className="capitalize">{a.type}</Table.Cell>
                        <Table.Cell
                          className={
                            a.amount < 0 ? "text-ui-fg-error" : ""
                          }
                        >
                          {a.amount < 0 ? "−" : ""}$
                          {Math.abs(a.amount).toFixed(2)}
                        </Table.Cell>
                        <Table.Cell>{a.notes || "—"}</Table.Cell>
                        <Table.Cell>
                          <Button
                            variant="transparent"
                            size="small"
                            onClick={() => removeAdjustment(i)}
                            type="button"
                          >
                            ×
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}
              <div className="grid grid-cols-12 gap-2 items-end pt-2">
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
                    disabled={!newAdj.amount}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {lines.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                <div className="flex justify-between text-ui-fg-subtle">
                  <Text size="small">Lines subtotal</Text>
                  <Text size="small" className="font-mono">
                    ${lineTotal.toFixed(2)}
                  </Text>
                </div>
                {adjustments.length > 0 && (
                  <div className="flex justify-between text-ui-fg-subtle">
                    <Text size="small">Adjustments</Text>
                    <Text
                      size="small"
                      className={`font-mono ${adjustmentTotal < 0 ? "text-ui-fg-error" : ""}`}
                    >
                      {adjustmentTotal < 0 ? "−" : ""}$
                      {Math.abs(adjustmentTotal).toFixed(2)}
                    </Text>
                  </div>
                )}
                <div className="flex justify-between pt-1">
                  <Text className="font-medium">PO total</Text>
                  <Text className="font-mono font-medium">
                    ${total.toFixed(2)}
                  </Text>
                </div>
              </div>
            )}

            {error && <Text className="text-ui-fg-error">{error}</Text>}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </Drawer.Close>
            <Button
              type="submit"
              disabled={saving || !supplierId || lines.length === 0}
            >
              {saving ? "Creating…" : "Create PO"}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  );
}
