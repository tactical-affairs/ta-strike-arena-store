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
  Textarea,
} from "@medusajs/ui";
import { useEffect, useState } from "react";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number | null;
  notes: string | null;
  created_at: string;
};

type DrawerState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; supplier: Supplier };

const SuppliersPage = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });

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
            Vendors we buy inventory from. Click a row to edit.
          </Text>
        </div>
        <Button onClick={() => setDrawer({ mode: "create" })}>
          Add supplier
        </Button>
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
              <Table.Row
                key={s.id}
                className="cursor-pointer hover:bg-ui-bg-base-hover"
                onClick={() => setDrawer({ mode: "edit", supplier: s })}
              >
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

      <SupplierDrawer
        state={drawer}
        onClose={() => setDrawer({ mode: "closed" })}
        onChanged={() => {
          setDrawer({ mode: "closed" });
          load();
        }}
      />
    </Container>
  );
};

type SupplierFormValues = {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  lead_time_days: string;
  notes: string;
};

const EMPTY_FORM: SupplierFormValues = {
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  lead_time_days: "",
  notes: "",
};

function valuesFor(supplier: Supplier): SupplierFormValues {
  return {
    name: supplier.name,
    contact_name: supplier.contact_name ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    lead_time_days: supplier.lead_time_days?.toString() ?? "",
    notes: supplier.notes ?? "",
  };
}

function SupplierDrawer({
  state,
  onClose,
  onChanged,
}: {
  state: DrawerState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<SupplierFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = state.mode !== "closed";
  const isEdit = state.mode === "edit";

  // Sync form values whenever the drawer opens with a different target
  useEffect(() => {
    if (state.mode === "edit") {
      setForm(valuesFor(state.supplier));
    } else if (state.mode === "create") {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [state]);

  const buildBody = () => ({
    name: form.name.trim(),
    contact_name: form.contact_name.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    lead_time_days: form.lead_time_days
      ? parseInt(form.lead_time_days, 10)
      : null,
    notes: form.notes.trim() || null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url =
        state.mode === "edit"
          ? `/admin/procurement/suppliers/${state.supplier.id}`
          : "/admin/procurement/suppliers";
      const method = state.mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (state.mode !== "edit") return;
    if (!window.confirm(`Delete ${state.supplier.name}? Historical purchase orders will keep referencing it.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/admin/procurement/suppliers/${state.supplier.id}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>{isEdit ? "Edit supplier" : "Add supplier"}</Drawer.Title>
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
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            {error && <Text className="text-ui-fg-error">{error}</Text>}
          </Drawer.Body>
          <Drawer.Footer>
            {isEdit && (
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={saving || deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            )}
            <Drawer.Close asChild>
              <Button variant="secondary" type="button" disabled={saving || deleting}>
                Cancel
              </Button>
            </Drawer.Close>
            <Button type="submit" disabled={saving || deleting || !form.name.trim()}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
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
