import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260507212933 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_status_check";`);

    // Consolidate retired statuses into 'open' before applying the narrower constraint.
    this.addSql(`update "purchase_order" set "status" = 'open' where "status" in ('draft', 'submitted');`);

    this.addSql(`alter table if exists "purchase_order" alter column "status" type text using ("status"::text);`);
    this.addSql(`alter table if exists "purchase_order" alter column "status" set default 'open';`);
    this.addSql(`alter table if exists "purchase_order" add constraint "purchase_order_status_check" check("status" in ('open', 'partial', 'closed', 'canceled'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "purchase_order" drop constraint if exists "purchase_order_status_check";`);

    // Reverse the consolidation: 'open' → 'draft'. The 'submitted' status is gone permanently
    // (we have no way to tell which 'open' rows were originally 'submitted'). This is a one-way
    // mapping in practice; the down() exists for migration framework completeness.
    this.addSql(`update "purchase_order" set "status" = 'draft' where "status" = 'open';`);

    this.addSql(`alter table if exists "purchase_order" alter column "status" type text using ("status"::text);`);
    this.addSql(`alter table if exists "purchase_order" alter column "status" set default 'draft';`);
    this.addSql(`alter table if exists "purchase_order" add constraint "purchase_order_status_check" check("status" in ('draft', 'submitted', 'partial', 'closed', 'canceled'));`);
  }

}
