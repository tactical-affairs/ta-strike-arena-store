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
  toast,
} from "@medusajs/ui";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  VariantTypeahead,
  variantLabel,
  type Variant,
} from "../variant-typeahead";

type Supplier = { id: string; name: string };

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
  open: "blue",
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
  const [editOpen, setEditOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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

  const handleCancel = async () => {
    if (!id || !po) return;
    if (
      !window.confirm(
        `Cancel ${po.po_number}? This cannot be undone. Adjustments and lines will be preserved for audit.`,
      )
    ) {
      return;
    }
    setCancelBusy(true);
    try {
      const res = await fetch(`/admin/procurement/purchase-orders/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      toast.success("Purchase order canceled");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCancelBusy(false);
    }
  };

  if (loading) return <Container className="p-6">Loading…</Container>;
  if (!po) return <Container className="p-6">Not found.</Container>;

  const isLocked = po.status === "closed" || po.status === "canceled";
  const canReceive = !isLocked;
  const hasReceipts = po.lines.some((l) => l.qty_received > 0);
  const canEdit = !isLocked;
  const canCancelPo = !isLocked && !hasReceipts;
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
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              size="small"
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
          )}
          {canCancelPo && (
            <Button
              variant="danger"
              size="small"
              onClick={handleCancel}
              disabled={cancelBusy}
            >
              {cancelBusy ? "Canceling…" : "Cancel PO"}
            </Button>
          )}
          {canReceive && (
            <Button onClick={() => setReceiveOpen(true)}>Receive items</Button>
          )}
        </div>
      </div>

      <LinesSection
        po={po}
        landedCosts={landedCosts}
        canEdit={canEdit}
        totalValue={totalValue}
        reload={load}
      />

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

      <EditDrawer
        po={po}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          load();
        }}
      />
    </Container>
  );
};

function LinesSection({
  po,
  landedCosts,
  canEdit,
  totalValue,
  reload,
}: {
  po: PurchaseOrder;
  landedCosts: LandedCosts;
  canEdit: boolean;
  totalValue: number;
  reload: () => Promise<void>;
}) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  // Per-line draft values for inline editing.
  const [drafts, setDrafts] = useState<
    Record<string, { qty: string; cost: string }>
  >({});
  // New-line draft.
  const [newLine, setNewLine] = useState({
    variant_id: "",
    qty: "",
    unit_cost: "",
  });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    (async () => {
      const res = await fetch(
        "/admin/products?limit=100&fields=id,title,variants.id,variants.sku,variants.title",
        { credentials: "include" },
      );
      const data = await res.json();
      const flat: Variant[] = [];
      for (const p of data.products ?? []) {
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
  }, [canEdit]);

  const variantById = (id: string): Variant | undefined =>
    variants.find((v) => v.id === id);

  const draftFor = (l: Line) =>
    drafts[l.id] ?? {
      qty: String(l.qty_ordered),
      cost: Number(l.unit_cost).toFixed(2),
    };

  const isDirty = (l: Line) => {
    const d = drafts[l.id];
    if (!d) return false;
    const qty = parseInt(d.qty, 10);
    const cost = parseFloat(d.cost);
    return qty !== l.qty_ordered || cost !== Number(l.unit_cost);
  };

  const setDraft = (
    lineId: string,
    field: "qty" | "cost",
    value: string,
  ) => {
    setDrafts((prev) => {
      const cur = prev[lineId] ?? {
        qty: String(po.lines.find((l) => l.id === lineId)?.qty_ordered ?? 0),
        cost: Number(
          po.lines.find((l) => l.id === lineId)?.unit_cost ?? 0,
        ).toFixed(2),
      };
      return { ...prev, [lineId]: { ...cur, [field]: value } };
    });
  };

  const saveLine = async (l: Line) => {
    const d = draftFor(l);
    const qty = parseInt(d.qty, 10);
    const cost = parseFloat(d.cost);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("qty must be a positive integer");
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError("unit cost must be ≥ 0");
      return;
    }
    setBusyLineId(l.id);
    setError(null);
    try {
      const res = await fetch(
        `/admin/procurement/purchase-orders/${po.id}/lines/${l.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qty_ordered: qty, unit_cost: cost }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[l.id];
        return next;
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyLineId(null);
    }
  };

  const removeLine = async (l: Line) => {
    if (
      !window.confirm(
        `Remove this line from the PO? This is only allowed because nothing has been received against it.`,
      )
    ) {
      return;
    }
    setBusyLineId(l.id);
    setError(null);
    try {
      const res = await fetch(
        `/admin/procurement/purchase-orders/${po.id}/lines/${l.id}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyLineId(null);
    }
  };

  const addLine = async () => {
    const qty = parseInt(newLine.qty, 10);
    const cost = parseFloat(newLine.unit_cost);
    if (!newLine.variant_id || !Number.isFinite(qty) || qty <= 0) return;
    if (!Number.isFinite(cost) || cost < 0) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/admin/procurement/purchase-orders/${po.id}/lines`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variant_id: newLine.variant_id,
            qty_ordered: qty,
            unit_cost: cost,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setNewLine({ variant_id: "", qty: "", unit_cost: "" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Variant</Table.HeaderCell>
            <Table.HeaderCell>Ordered</Table.HeaderCell>
            <Table.HeaderCell>Received</Table.HeaderCell>
            <Table.HeaderCell>Unit cost</Table.HeaderCell>
            <Table.HeaderCell>Landed unit cost</Table.HeaderCell>
            <Table.HeaderCell>Line total</Table.HeaderCell>
            {canEdit && <Table.HeaderCell></Table.HeaderCell>}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {po.lines.map((l) => {
            const landed = landedCosts[l.id];
            const landedCost =
              landed?.landed_unit_cost ?? Number(l.unit_cost);
            const delta = landedCost - Number(l.unit_cost);
            const v = variantById(l.variant_id);
            const label = v ? variantLabel(v) : l.variant_id;
            const dirty = canEdit && isDirty(l);
            const draft = draftFor(l);
            const busy = busyLineId === l.id;
            const lineTotal =
              (parseInt(draft.qty, 10) || 0) *
              (parseFloat(draft.cost) || 0);
            return (
              <Table.Row key={l.id}>
                <Table.Cell>
                  {v ? (
                    <Text size="small" className="break-words">
                      {label}
                    </Text>
                  ) : (
                    <span className="font-mono text-ui-fg-subtle text-xs">
                      {l.variant_id}
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {canEdit ? (
                    <Input
                      type="number"
                      min="1"
                      value={draft.qty}
                      onChange={(e) =>
                        setDraft(l.id, "qty", e.target.value)
                      }
                      disabled={busy}
                      className="w-20"
                    />
                  ) : (
                    l.qty_ordered
                  )}
                </Table.Cell>
                <Table.Cell>
                  {l.qty_received}
                  {l.qty_received >= l.qty_ordered ? " ✓" : ""}
                </Table.Cell>
                <Table.Cell>
                  {canEdit ? (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.cost}
                      onChange={(e) =>
                        setDraft(l.id, "cost", e.target.value)
                      }
                      disabled={busy}
                      className="w-24"
                    />
                  ) : (
                    `$${Number(l.unit_cost).toFixed(2)}`
                  )}
                </Table.Cell>
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
                <Table.Cell className="font-mono">
                  ${lineTotal.toFixed(2)}
                </Table.Cell>
                {canEdit && (
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      {dirty && (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => saveLine(l)}
                          disabled={busy}
                        >
                          {busy ? "…" : "Save"}
                        </Button>
                      )}
                      {l.qty_received === 0 && (
                        <Button
                          variant="transparent"
                          size="small"
                          onClick={() => removeLine(l)}
                          disabled={busy}
                          aria-label="Remove line"
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  </Table.Cell>
                )}
              </Table.Row>
            );
          })}
          <Table.Row>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell className="font-medium text-right">
              PO total
            </Table.Cell>
            <Table.Cell className="font-mono font-medium">
              ${totalValue.toFixed(2)}
            </Table.Cell>
            {canEdit && <Table.Cell></Table.Cell>}
          </Table.Row>
        </Table.Body>
      </Table>

      {canEdit && (
        <div className="px-6 py-4 border-t space-y-2">
          <Label>Add line</Label>
          <VariantTypeahead
            variants={variants}
            value={newLine.variant_id}
            onChange={(id) =>
              setNewLine({ ...newLine, variant_id: id })
            }
          />
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
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
            <div className="col-span-5">
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
            <div className="col-span-3">
              <Button
                size="small"
                variant="secondary"
                onClick={addLine}
                disabled={
                  adding ||
                  !newLine.variant_id ||
                  !newLine.qty ||
                  !newLine.unit_cost
                }
              >
                {adding ? "Adding…" : "Add line"}
              </Button>
            </div>
          </div>
          {error && <Text className="text-ui-fg-error">{error}</Text>}
        </div>
      )}
    </>
  );
}

function EditDrawer({
  po,
  open,
  onClose,
  onSaved,
}: {
  po: PurchaseOrder;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [poNumber, setPoNumber] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [expectedAt, setExpectedAt] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPoNumber(po.po_number);
    setSupplierId(po.supplier?.id ?? "");
    setExpectedAt(
      po.expected_at ? po.expected_at.slice(0, 10) : "",
    );
    setNotes(po.notes ?? "");
    setError(null);
    (async () => {
      const res = await fetch("/admin/procurement/suppliers", {
        credentials: "include",
      });
      const data = await res.json();
      setSuppliers(data.suppliers ?? []);
    })();
  }, [open, po.id, po.supplier?.id, po.expected_at, po.notes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) {
      setError("Supplier is required");
      return;
    }
    if (!poNumber.trim()) {
      setError("PO number is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/admin/procurement/purchase-orders/${po.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          po_number: poNumber.trim(),
          supplier_id: supplierId,
          expected_at: expectedAt || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      toast.success("Purchase order updated");
      onSaved();
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
          <Drawer.Title>Edit {po.po_number}</Drawer.Title>
        </Drawer.Header>
        <form onSubmit={handleSubmit}>
          <Drawer.Body className="space-y-4">
            <Text size="small" className="text-ui-fg-subtle">
              Editing PO number, supplier, expected delivery, or notes is
              always allowed while the PO is open. Adjustments are managed
              below the line items on the detail page. To change line items,
              cancel this PO and create a new one (lots already received
              cannot be unwound).
            </Text>
            <div>
              <Label>PO number *</Label>
              <Input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. match your supplier's PO number"
              />
            </div>
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
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
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
              disabled={saving || !supplierId || !poNumber.trim()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  );
}

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
  const [variantLabels, setVariantLabels] = useState<Record<string, string>>(
    {},
  );
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

      // Look up inventory_item_id + human-readable label for each variant.
      // Walk products (same pattern as LinesSection) — the variants endpoint
      // doesn't reliably hydrate the product relation in Medusa v2 admin.
      const variantIds = new Set(
        po.lines.map((l) => l.variant_id).filter(Boolean),
      );
      if (variantIds.size > 0) {
        const prodRes = await fetch(
          "/admin/products?limit=200&fields=id,title,variants.id,variants.sku,variants.title,variants.inventory_items.inventory.id",
          { credentials: "include" },
        );
        const prodData = await prodRes.json();
        const invMap: Record<string, string> = {};
        const labelMap: Record<string, string> = {};
        for (const p of prodData.products ?? []) {
          for (const v of p.variants ?? []) {
            if (!variantIds.has(v.id)) continue;
            const invItem = v.inventory_items?.[0]?.inventory?.id;
            if (invItem) invMap[v.id] = invItem;
            labelMap[v.id] = variantLabel({
              id: v.id,
              sku: v.sku ?? null,
              title: v.title,
              product: { title: p.title },
            });
          }
        }
        setInventoryItemIds(invMap);
        setVariantLabels(labelMap);
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
                  const label = variantLabels[l.variant_id] ?? l.variant_id;
                  return (
                    <Table.Row key={l.id}>
                      <Table.Cell>
                        <Text size="small" className="break-words">
                          {label}
                        </Text>
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
