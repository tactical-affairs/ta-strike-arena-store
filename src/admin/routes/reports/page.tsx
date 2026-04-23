import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Tabs,
  Text,
} from "@medusajs/ui";
import { useEffect, useMemo, useState } from "react";

type ValuationRow = {
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  active_lots: number;
  qty_on_hand: number;
  weighted_avg_cost: number | null;
  inventory_value: number;
};
type ValuationResp = {
  rows: ValuationRow[];
  totals: { qty: number; value: number };
};

type CogsRow = {
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  qty_sold: number;
  cogs_gross: number;
  cogs_reversed: number;
  cogs_net: number;
};
type CogsResp = {
  rows: CogsRow[];
  totals: { qty: number; cogs_gross: number; cogs_reversed: number; cogs_net: number };
};

type MarginRow = {
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  qty_sold: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  margin_pct: number | null;
};
type MarginResp = {
  rows: MarginRow[];
  totals: { qty: number; revenue: number; cogs: number; gross_profit: number; margin_pct: number | null };
};

type SlowRow = {
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  lot_id: string;
  received_at: string;
  age_days: number;
  qty_remaining: number;
  unit_cost: number;
  stuck_value: number;
};
type SlowResp = {
  rows: SlowRow[];
  totals: { count: number; stuck_value: number };
  threshold_days: number;
};

const fmt$ = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`;

function toCSV(
  rows: Record<string, unknown>[],
  headers: string[],
): string {
  const escape = (v: unknown): string => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  // Always emit the header row so the file is never zero-bytes even
  // when there's nothing to export (e.g., slow-movers with no lots
  // over threshold).
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const ReportsPage = () => {
  return (
    <Container className="p-0">
      <div className="px-6 py-4 border-b">
        <Heading level="h2">Reports</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Inventory valuation, COGS, gross margin, and slow-mover
          analysis. All reports can be exported to CSV for the accountant.
        </Text>
      </div>
      <Tabs defaultValue="valuation">
        <Tabs.List className="px-6 pt-4">
          <Tabs.Trigger value="valuation">Inventory valuation</Tabs.Trigger>
          <Tabs.Trigger value="cogs">COGS by period</Tabs.Trigger>
          <Tabs.Trigger value="margin">Gross margin</Tabs.Trigger>
          <Tabs.Trigger value="slow">Slow movers</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="valuation" className="p-6">
          <ValuationPanel />
        </Tabs.Content>
        <Tabs.Content value="cogs" className="p-6">
          <CogsPanel />
        </Tabs.Content>
        <Tabs.Content value="margin" className="p-6">
          <MarginPanel />
        </Tabs.Content>
        <Tabs.Content value="slow" className="p-6">
          <SlowPanel />
        </Tabs.Content>
      </Tabs>
    </Container>
  );
};

const VALUATION_HEADERS = [
  "sku",
  "product",
  "variant",
  "active_lots",
  "qty_on_hand",
  "weighted_avg_cost",
  "inventory_value",
];

function ValuationPanel() {
  const [data, setData] = useState<ValuationResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);

  const fetchData = async (): Promise<ValuationResp | null> => {
    const res = await fetch(
      "/admin/procurement/reports/inventory-valuation",
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as ValuationResp;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setData(await fetchData());
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const exportCsv = async () => {
    setExportBusy(true);
    try {
      // Fetch fresh at click time — don't rely on whatever's in state.
      const fresh = await fetchData();
      const rows = (fresh?.rows ?? []).map((r) => ({
        sku: r.sku ?? "",
        product: r.product_title ?? "",
        variant: r.variant_title ?? "",
        active_lots: r.active_lots,
        qty_on_hand: r.qty_on_hand,
        weighted_avg_cost: r.weighted_avg_cost ?? "",
        inventory_value: r.inventory_value,
      }));
      download(
        `inventory-valuation-${todayISO()}.csv`,
        toCSV(rows, VALUATION_HEADERS),
      );
    } finally {
      setExportBusy(false);
    }
  };

  if (loading) return <Text>Loading…</Text>;
  if (!data) return <Text>No data.</Text>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          Snapshot of currently stocked inventory valued at FIFO cost.
        </Text>
        <Button
          variant="secondary"
          size="small"
          onClick={exportCsv}
          disabled={exportBusy}
        >
          {exportBusy ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Product</Table.HeaderCell>
            <Table.HeaderCell>SKU</Table.HeaderCell>
            <Table.HeaderCell>Lots</Table.HeaderCell>
            <Table.HeaderCell>Qty on hand</Table.HeaderCell>
            <Table.HeaderCell>Wtd. avg cost</Table.HeaderCell>
            <Table.HeaderCell>Inventory value</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {data.rows.map((r) => (
            <Table.Row key={(r.sku ?? r.product_title ?? "") + r.qty_on_hand}>
              <Table.Cell>
                {r.product_title ?? "?"}
                {r.variant_title && r.variant_title !== "Default" ? (
                  <span className="text-ui-fg-subtle ml-2">({r.variant_title})</span>
                ) : null}
              </Table.Cell>
              <Table.Cell className="font-mono text-xs">
                {r.sku ?? "—"}
              </Table.Cell>
              <Table.Cell>{r.active_lots}</Table.Cell>
              <Table.Cell>{r.qty_on_hand}</Table.Cell>
              <Table.Cell>{fmt$(r.weighted_avg_cost)}</Table.Cell>
              <Table.Cell className="font-mono">
                {fmt$(r.inventory_value)}
              </Table.Cell>
            </Table.Row>
          ))}
          <Table.Row>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell></Table.Cell>
            <Table.Cell className="font-medium">{data.totals.qty}</Table.Cell>
            <Table.Cell className="font-medium text-right">Total</Table.Cell>
            <Table.Cell className="font-mono font-medium">
              {fmt$(data.totals.value)}
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table>
    </div>
  );
}

const COGS_HEADERS = [
  "sku",
  "product",
  "variant",
  "qty_sold",
  "cogs_gross",
  "cogs_reversed",
  "cogs_net",
];

function CogsPanel() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<CogsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const fetchData = async (
    fromDate: string,
    toDate: string,
  ): Promise<CogsResp | null> => {
    const res = await fetch(
      `/admin/procurement/reports/cogs?from=${fromDate}&to=${toDate}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as CogsResp;
  };

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchData(from, to));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = async () => {
    setExportBusy(true);
    try {
      const fresh = await fetchData(from, to);
      const rows = (fresh?.rows ?? []).map((r) => ({
        sku: r.sku ?? "",
        product: r.product_title ?? "",
        variant: r.variant_title ?? "",
        qty_sold: r.qty_sold,
        cogs_gross: r.cogs_gross,
        cogs_reversed: r.cogs_reversed,
        cogs_net: r.cogs_net,
      }));
      download(`cogs-${from}-to-${to}.csv`, toCSV(rows, COGS_HEADERS));
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button size="small" onClick={load}>
          Apply
        </Button>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="small"
          onClick={exportCsv}
          disabled={exportBusy}
        >
          {exportBusy ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
      {loading || !data ? (
        <Text>Loading…</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Qty sold</Table.HeaderCell>
              <Table.HeaderCell>COGS gross</Table.HeaderCell>
              <Table.HeaderCell>Reversed</Table.HeaderCell>
              <Table.HeaderCell>COGS net</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.rows.map((r) => (
              <Table.Row key={(r.sku ?? r.product_title ?? "") + r.cogs_net}>
                <Table.Cell>{r.product_title ?? "?"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{r.sku ?? "—"}</Table.Cell>
                <Table.Cell>{r.qty_sold}</Table.Cell>
                <Table.Cell className="font-mono">{fmt$(r.cogs_gross)}</Table.Cell>
                <Table.Cell className="font-mono text-ui-fg-subtle">
                  {r.cogs_reversed > 0 ? fmt$(r.cogs_reversed) : "—"}
                </Table.Cell>
                <Table.Cell className="font-mono font-medium">
                  {fmt$(r.cogs_net)}
                </Table.Cell>
              </Table.Row>
            ))}
            <Table.Row>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell className="font-medium">{data.totals.qty}</Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.cogs_gross)}
              </Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {data.totals.cogs_reversed > 0 ? fmt$(data.totals.cogs_reversed) : "—"}
              </Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.cogs_net)}
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

const MARGIN_HEADERS = [
  "sku",
  "product",
  "variant",
  "qty_sold",
  "revenue",
  "cogs",
  "gross_profit",
  "margin_pct",
];

function MarginPanel() {
  const [from, setFrom] = useState(firstOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<MarginResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const fetchData = async (
    fromDate: string,
    toDate: string,
  ): Promise<MarginResp | null> => {
    const res = await fetch(
      `/admin/procurement/reports/gross-margin?from=${fromDate}&to=${toDate}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as MarginResp;
  };

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchData(from, to));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = async () => {
    setExportBusy(true);
    try {
      const fresh = await fetchData(from, to);
      const rows = (fresh?.rows ?? []).map((r) => ({
        sku: r.sku ?? "",
        product: r.product_title ?? "",
        variant: r.variant_title ?? "",
        qty_sold: r.qty_sold,
        revenue: r.revenue,
        cogs: r.cogs,
        gross_profit: r.gross_profit,
        margin_pct: r.margin_pct != null ? r.margin_pct.toFixed(2) : "",
      }));
      download(
        `gross-margin-${from}-to-${to}.csv`,
        toCSV(rows, MARGIN_HEADERS),
      );
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button size="small" onClick={load}>
          Apply
        </Button>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="small"
          onClick={exportCsv}
          disabled={exportBusy}
        >
          {exportBusy ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
      {loading || !data ? (
        <Text>Loading…</Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Qty sold</Table.HeaderCell>
              <Table.HeaderCell>Revenue</Table.HeaderCell>
              <Table.HeaderCell>COGS</Table.HeaderCell>
              <Table.HeaderCell>Gross profit</Table.HeaderCell>
              <Table.HeaderCell>Margin %</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.rows.map((r) => (
              <Table.Row key={(r.sku ?? r.product_title ?? "") + r.cogs}>
                <Table.Cell>{r.product_title ?? "?"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{r.sku ?? "—"}</Table.Cell>
                <Table.Cell>{r.qty_sold}</Table.Cell>
                <Table.Cell className="font-mono">{fmt$(r.revenue)}</Table.Cell>
                <Table.Cell className="font-mono">{fmt$(r.cogs)}</Table.Cell>
                <Table.Cell className="font-mono font-medium">
                  {fmt$(r.gross_profit)}
                </Table.Cell>
                <Table.Cell>{fmtPct(r.margin_pct)}</Table.Cell>
              </Table.Row>
            ))}
            <Table.Row>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell className="font-medium">{data.totals.qty}</Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.revenue)}
              </Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.cogs)}
              </Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.gross_profit)}
              </Table.Cell>
              <Table.Cell className="font-medium">
                {fmtPct(data.totals.margin_pct)}
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

const SLOW_HEADERS = [
  "sku",
  "product",
  "variant",
  "lot_id",
  "received_at",
  "age_days",
  "qty_remaining",
  "unit_cost",
  "stuck_value",
];

function SlowPanel() {
  const [days, setDays] = useState("90");
  const [data, setData] = useState<SlowResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);

  const fetchData = async (d: string): Promise<SlowResp | null> => {
    const res = await fetch(
      `/admin/procurement/reports/slow-movers?days=${encodeURIComponent(d)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    return (await res.json()) as SlowResp;
  };

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchData(days));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = async () => {
    setExportBusy(true);
    try {
      const fresh = await fetchData(days);
      const rows = (fresh?.rows ?? []).map((r) => ({
        sku: r.sku ?? "",
        product: r.product_title ?? "",
        variant: r.variant_title ?? "",
        lot_id: r.lot_id,
        received_at: r.received_at,
        age_days: r.age_days,
        qty_remaining: r.qty_remaining,
        unit_cost: r.unit_cost,
        stuck_value: r.stuck_value,
      }));
      download(
        `slow-movers-${days}d-${todayISO()}.csv`,
        toCSV(rows, SLOW_HEADERS),
      );
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <Label>Older than (days)</Label>
          <Input type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <Button size="small" onClick={load}>
          Apply
        </Button>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="small"
          onClick={exportCsv}
          disabled={exportBusy}
        >
          {exportBusy ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
      {loading || !data ? (
        <Text>Loading…</Text>
      ) : data.rows.length === 0 ? (
        <Text className="text-ui-fg-subtle">
          No active lots older than {data.threshold_days} days. Inventory is turning well.
        </Text>
      ) : (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Product</Table.HeaderCell>
              <Table.HeaderCell>SKU</Table.HeaderCell>
              <Table.HeaderCell>Lot</Table.HeaderCell>
              <Table.HeaderCell>Received</Table.HeaderCell>
              <Table.HeaderCell>Age (days)</Table.HeaderCell>
              <Table.HeaderCell>Qty remaining</Table.HeaderCell>
              <Table.HeaderCell>Unit cost</Table.HeaderCell>
              <Table.HeaderCell>Stuck value</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.rows.map((r) => (
              <Table.Row key={r.lot_id}>
                <Table.Cell>{r.product_title ?? "?"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{r.sku ?? "—"}</Table.Cell>
                <Table.Cell className="font-mono text-xs">{r.lot_id}</Table.Cell>
                <Table.Cell>
                  {new Date(r.received_at).toLocaleDateString()}
                </Table.Cell>
                <Table.Cell>{r.age_days}</Table.Cell>
                <Table.Cell>{r.qty_remaining}</Table.Cell>
                <Table.Cell className="font-mono">{fmt$(r.unit_cost)}</Table.Cell>
                <Table.Cell className="font-mono font-medium">
                  {fmt$(r.stuck_value)}
                </Table.Cell>
              </Table.Row>
            ))}
            <Table.Row>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell></Table.Cell>
              <Table.Cell className="font-medium text-right">Total stuck</Table.Cell>
              <Table.Cell className="font-mono font-medium">
                {fmt$(data.totals.stuck_value)}
              </Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      )}
    </div>
  );
}

export const config = defineRouteConfig({
  label: "Reports",
  icon: ChartBar,
});

export default ReportsPage;
