import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260423220713 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "po_adjustment" ("id" text not null, "type" text check ("type" in ('shipping', 'discount', 'tariff', 'other')) not null default 'shipping', "amount" numeric not null, "currency" text not null default 'usd', "notes" text null, "metadata" jsonb null, "purchase_order_id" text not null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "po_adjustment_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_po_adjustment_purchase_order_id" ON "po_adjustment" ("purchase_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_po_adjustment_deleted_at" ON "po_adjustment" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "po_adjustment" add constraint "po_adjustment_purchase_order_id_foreign" foreign key ("purchase_order_id") references "purchase_order" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "po_adjustment" cascade;`);
  }

}
