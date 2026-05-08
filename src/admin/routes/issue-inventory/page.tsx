import { defineRouteConfig } from "@medusajs/admin-sdk";
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { useEffect, useMemo, useState } from "react";
import {
  VariantTypeahead,
  type Variant,
} from "../purchase-orders/variant-typeahead";

type Location = { id: string; name: string };

const REASONS: ReadonlyArray<{
  value: "demo" | "sample" | "internal_use" | "damaged_post_receipt" | "write_off";
  label: string;
  hint: string;
}> = [
  { value: "demo", label: "Demo", hint: "Unit pulled for sales/marketing demos" },
  { value: "sample", label: "Sample", hint: "Sent to a prospect, reviewer, or partner" },
  { value: "internal_use", label: "Internal use", hint: "Consumed by the team for testing or reference" },
  { value: "damaged_post_receipt", label: "Damaged (post-receipt)", hint: "Damaged after it was received in good condition" },
  { value: "write_off", label: "Write-off", hint: "Catch-all — lost, expired, otherwise unsellable" },
];

type IssueRecord = {
  variant_label: string;
  qty: number;
  reason: string;
  total_cost: number;
  posted_at: string;
};

const IssueInventoryPage = () => {
  const [variants, setVariants] = useState<Variant[]>([]);
  // Map variant_id -> { inventory_item_id, levels: Record<location_id, qty> }
  const [variantMeta, setVariantMeta] = useState<
    Record<
      string,
      {
        inventory_item_id: string;
        levels: Record<string, number>;
      }
    >
  >({});
  const [locations, setLocations] = useState<Location[]>([]);

  const [variantId, setVariantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<typeof REASONS[number]["value"]>("demo");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<IssueRecord[]>([]);

  useEffect(() => {
    (async () => {
      const [prodRes, locRes] = await Promise.all([
        fetch(
          "/admin/products?limit=200&fields=id,title,variants.id,variants.sku,variants.title,variants.inventory_items.inventory.id,variants.inventory_items.inventory.location_levels.location_id,variants.inventory_items.inventory.location_levels.stocked_quantity",
          { credentials: "include" },
        ),
        fetch("/admin/stock-locations?fields=id,name", {
          credentials: "include",
        }),
      ]);
      const prodData = await prodRes.json();
      const locData = await locRes.json();

      const flat: Variant[] = [];
      const meta: typeof variantMeta = {};
      for (const p of prodData.products ?? []) {
        for (const v of p.variants ?? []) {
          flat.push({
            id: v.id,
            sku: v.sku ?? null,
            title: v.title,
            product: { title: p.title },
          });
          const inv = v.inventory_items?.[0]?.inventory;
          if (inv?.id) {
            const levels: Record<string, number> = {};
            for (const lvl of inv.location_levels ?? []) {
              levels[lvl.location_id] = Number(lvl.stocked_quantity ?? 0);
            }
            meta[v.id] = { inventory_item_id: inv.id, levels };
          }
        }
      }
      setVariants(flat);
      setVariantMeta(meta);
      setLocations(locData.stock_locations ?? []);
      if (locData.stock_locations?.length === 1) {
        setLocationId(locData.stock_locations[0].id);
      }
    })();
  }, []);

  const selectedVariant = variants.find((v) => v.id === variantId);
  const meta = variantId ? variantMeta[variantId] : undefined;
  const available = useMemo(() => {
    if (!meta || !locationId) return null;
    return meta.levels[locationId] ?? 0;
  }, [meta, locationId]);

  const qtyNum = parseInt(qty, 10);
  const canSubmit =
    !!variantId &&
    !!locationId &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    available !== null &&
    qtyNum <= available;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !meta) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/admin/procurement/inventory-issues", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: meta.inventory_item_id,
          location_id: locationId,
          qty: qtyNum,
          reason,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? `HTTP ${res.status}`);
      }
      toast.success(
        `Issued ${qtyNum} × ${selectedVariant ? selectedVariant.product?.title : ""} (${reason})`,
      );
      setRecent((prev) =>
        [
          {
            variant_label: selectedVariant
              ? `${selectedVariant.product?.title} — ${selectedVariant.title}${selectedVariant.sku ? ` (${selectedVariant.sku})` : ""}`
              : variantId,
            qty: qtyNum,
            reason,
            total_cost: Number(data.total_cost ?? 0),
            posted_at: data.issued?.posted_at ?? new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 10),
      );
      // Optimistically update available count so the user can issue another
      // unit from the same variant without a refresh.
      setVariantMeta((prev) => {
        const cur = prev[variantId];
        if (!cur) return prev;
        return {
          ...prev,
          [variantId]: {
            ...cur,
            levels: {
              ...cur.levels,
              [locationId]: (cur.levels[locationId] ?? 0) - qtyNum,
            },
          },
        };
      });
      setQty("");
      setNotes("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container className="p-0">
      <div className="px-6 py-4 border-b">
        <Heading level="h2">Issue inventory</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Take stock off the books for non-sales reasons (demos, samples,
          internal use, write-offs). FIFO lots are consumed and a COGS
          entry is posted with the chosen reason — the financial picture
          stays accurate without a real customer order.
        </Text>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="px-6 py-4 space-y-4 border-b">
          <div>
            <Label>Variant *</Label>
            <VariantTypeahead
              variants={variants}
              value={variantId}
              onChange={(id) => {
                setVariantId(id);
                setError(null);
              }}
            />
          </div>

          <div>
            <Label>Location *</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <Select.Trigger>
                <Select.Value placeholder="Pick a stock location" />
              </Select.Trigger>
              <Select.Content>
                {locations.map((l) => (
                  <Select.Item key={l.id} value={l.id}>
                    {l.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
            {variantId && locationId && available !== null && (
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {available} unit{available === 1 ? "" : "s"} available at this
                location
              </Text>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Quantity *</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1"
              />
            </div>
            <div>
              <Label>Reason *</Label>
              <Select
                value={reason}
                onValueChange={(v) => setReason(v as typeof reason)}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {REASONS.map((r) => (
                    <Select.Item key={r.value} value={r.value}>
                      {r.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                {REASONS.find((r) => r.value === reason)?.hint}
              </Text>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. demo unit at Range Day with Acme PD; serial 1234-XYZ"
            />
          </div>

          {error && (
            <div className="rounded border border-ui-border-error bg-ui-bg-base p-3">
              <Text size="small" className="text-ui-fg-error">
                {error}
              </Text>
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? "Issuing…" : "Issue from inventory"}
            </Button>
          </div>
        </div>
      </form>

      {recent.length > 0 && (
        <div className="px-6 py-4 space-y-3">
          <Text size="small" className="font-medium uppercase tracking-wider text-ui-fg-subtle">
            Recent issues this session
          </Text>
          <ul className="space-y-2">
            {recent.map((r, i) => (
              <li
                key={i}
                className="flex items-start justify-between gap-4 rounded border border-ui-border-base px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <Text size="small" className="break-words">
                    {r.variant_label}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    {r.qty} × {r.reason} · COGS posted ${r.total_cost.toFixed(2)}
                  </Text>
                </div>
                <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
                  {new Date(r.posted_at).toLocaleTimeString()}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Issue inventory",
});

export default IssueInventoryPage;
