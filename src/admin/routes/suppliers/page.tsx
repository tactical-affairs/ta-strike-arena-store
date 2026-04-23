import { defineRouteConfig } from "@medusajs/admin-sdk";
import { BuildingTax } from "@medusajs/icons";
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Table,
  Text,
  Drawer,
} from "@medusajs/ui";
import { useEffect, useState } from "react";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number | null;
  created_at: string;
};

const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/admin/procurement/suppliers", {
        credentials: "include",
      });
      const data = await res.json();
      setSuppliers(data.suppliers ?? []);
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
          <Heading level="h2">Suppliers</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Vendors we buy inventory from.
          </Text>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>Add supplier</Button>
      </div>

      <Table>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell>Name</Table.HeaderCell>
            <Table.HeaderCell>Contact</Table.HeaderCell>
            <Table.HeaderCell>Email</Table.HeaderCell>
            <Table.HeaderCell>Phone</Table.HeaderCell>
            <Table.HeaderCell>Lead time</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {loading ? (
            <Table.Row>
              <Table.Cell>Loading…</Table.Cell>
            </Table.Row>
          ) : suppliers.length === 0 ? (
            <Table.Row>
              <Table.Cell>
                <Text className="text-ui-fg-subtle">
                  No suppliers yet. Add one to start creating purchase orders.
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            suppliers.map((s) => (
              <Table.Row key={s.id}>
                <Table.Cell className="font-medium">{s.name}</Table.Cell>
                <Table.Cell>{s.contact_name ?? "—"}</Table.Cell>
                <Table.Cell>{s.email ?? "—"}</Table.Cell>
                <Table.Cell>{s.phone ?? "—"}</Table.Cell>
                <Table.Cell>
                  {s.lead_time_days ? `${s.lead_time_days} days` : "—"}
                </Table.Cell>
              </Table.Row>
            ))
          )}
        </Table.Body>
      </Table>

      <CreateSupplierDrawer
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

function CreateSupplierDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    contact_name: "",
    email: "",
    phone: "",
    lead_time_days: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/admin/procurement/suppliers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          lead_time_days: form.lead_time_days
            ? parseInt(form.lead_time_days, 10)
            : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      setForm({
        name: "",
        contact_name: "",
        email: "",
        phone: "",
        lead_time_days: "",
        notes: "",
      });
      onCreated();
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
          <Drawer.Title>Add supplier</Drawer.Title>
        </Drawer.Header>
        <form onSubmit={handleSubmit}>
          <Drawer.Body className="space-y-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="contact_name">Contact name</Label>
              <Input
                id="contact_name"
                value={form.contact_name}
                onChange={(e) =>
                  setForm({ ...form, contact_name: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="lead_time_days">Lead time (days)</Label>
              <Input
                id="lead_time_days"
                type="number"
                value={form.lead_time_days}
                onChange={(e) =>
                  setForm({ ...form, lead_time_days: e.target.value })
                }
              />
            </div>
            {error && <Text className="text-ui-fg-error">{error}</Text>}
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
            <Button type="submit" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </Drawer.Footer>
        </form>
      </Drawer.Content>
    </Drawer>
  );
}

export const config = defineRouteConfig({
  label: "Suppliers",
  icon: BuildingTax,
});

export default SuppliersPage;
