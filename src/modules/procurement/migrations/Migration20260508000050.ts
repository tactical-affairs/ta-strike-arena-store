import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260508000050 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cogs_entry" add column if not exists "reason" text check ("reason" in ('sale', 'demo', 'sample', 'internal_use', 'damaged_post_receipt', 'write_off')) not null default 'sale', add column if not exists "notes" text null;`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_id" type text using ("order_id"::text);`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_id" drop not null;`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_line_item_id" type text using ("order_line_item_id"::text);`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_line_item_id" drop not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "cogs_entry" drop column if exists "reason", drop column if exists "notes";`);

    this.addSql(`alter table if exists "cogs_entry" alter column "order_id" type text using ("order_id"::text);`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_id" set not null;`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_line_item_id" type text using ("order_line_item_id"::text);`);
    this.addSql(`alter table if exists "cogs_entry" alter column "order_line_item_id" set not null;`);
  }

}
