import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260423213632 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_po_number_unique";`);
    this.addSql(`create table if not exists "cogs_entry" ("id" text not null, "order_id" text not null, "order_line_item_id" text not null, "lot_id" text not null, "qty" integer not null, "unit_cost" numeric not null, "total_cost" numeric not null, "currency" text not null default 'usd', "posted_at" timestamptz not null, "reversed_at" timestamptz null, "metadata" jsonb null, "raw_unit_cost" jsonb not null, "raw_total_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cogs_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cogs_entry_deleted_at" ON "cogs_entry" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "inventory_lot" ("id" text not null, "inventory_item_id" text not null, "po_line_id" text null, "location_id" text not null, "qty_initial" integer not null, "qty_remaining" integer not null, "unit_cost" numeric not null, "currency" text not null default 'usd', "received_at" timestamptz not null, "status" text check ("status" in ('active', 'exhausted', 'damaged')) not null default 'active', "source" text check ("source" in ('po', 'return_restock', 'opening_balance')) not null default 'po', "metadata" jsonb null, "raw_unit_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "inventory_lot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_inventory_lot_deleted_at" ON "inventory_lot" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier" ("id" text not null, "name" text not null, "contact_name" text null, "email" text null, "phone" text null, "default_currency" text not null default 'usd', "lead_time_days" integer null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_deleted_at" ON "supplier" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "purchase_order" ("id" text not null, "po_number" text not null, "status" text check ("status" in ('draft', 'submitted', 'partial', 'closed', 'canceled')) not null default 'draft', "ordered_at" timestamptz null, "expected_at" timestamptz null, "notes" text null, "created_by" text null, "metadata" jsonb null, "supplier_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "purchase_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_order_po_number_unique" ON "purchase_order" ("po_number") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_supplier_id" ON "purchase_order" ("supplier_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_purchase_order_deleted_at" ON "purchase_order" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "po_line" ("id" text not null, "variant_id" text not null, "qty_ordered" integer not null, "qty_received" integer not null default 0, "unit_cost" numeric not null, "currency" text not null default 'usd', "metadata" jsonb null, "purchase_order_id" text not null, "raw_unit_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "po_line_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_po_line_purchase_order_id" ON "po_line" ("purchase_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_po_line_deleted_at" ON "po_line" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "purchase_order" add constraint "purchase_order_supplier_id_foreign" foreign key ("supplier_id") references "supplier" ("id") on update cascade;`);

    this.addSql(`alter table if exists "po_line" add constraint "po_line_purchase_order_id_foreign" foreign key ("purchase_order_id") references "purchase_order" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_supplier_id_foreign";`);

    this.addSql(`alter table if exists "po_line" drop constraint if exists "po_line_purchase_order_id_foreign";`);

    this.addSql(`drop table if exists "cogs_entry" cascade;`);

    this.addSql(`drop table if exists "inventory_lot" cascade;`);

    this.addSql(`drop table if exists "supplier" cascade;`);

    this.addSql(`drop table if exists "purchase_order" cascade;`);

    this.addSql(`drop table if exists "po_line" cascade;`);
  }

}
