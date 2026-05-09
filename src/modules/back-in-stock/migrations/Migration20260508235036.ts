import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260508235036 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "back_in_stock_subscription" drop constraint if exists "back_in_stock_subscription_email_variant_id_unique";`);
    this.addSql(`create table if not exists "back_in_stock_subscription" ("id" text not null, "email" text not null, "variant_id" text not null, "notified_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "back_in_stock_subscription_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_back_in_stock_subscription_deleted_at" ON "back_in_stock_subscription" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_back_in_stock_subscription_variant_id" ON "back_in_stock_subscription" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_back_in_stock_subscription_email" ON "back_in_stock_subscription" ("email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_back_in_stock_subscription_email_variant_id_unique" ON "back_in_stock_subscription" ("email", "variant_id") WHERE notified_at IS NULL AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "back_in_stock_subscription" cascade;`);
  }

}
