/**
 * Back-in-stock notification module service.
 *
 * Stores customer subscriptions to be emailed when a specific variant
 * is back in stock. The Store API route inserts; the inventory
 * subscriber drains pending rows and sends email via the notification
 * module.
 */

import { MedusaService } from "@medusajs/framework/utils";
import { BackInStockSubscription } from "./models/back-in-stock-subscription";

class BackInStockModuleService extends MedusaService({
  BackInStockSubscription,
}) {
  /**
   * Idempotent subscribe: if a pending row already exists for
   * (email, variant_id), reuses it. Otherwise inserts a new row.
   */
  async subscribe(input: {
    email: string;
    variant_id: string;
  }): Promise<{ id: string; created: boolean }> {
    const email = input.email.trim().toLowerCase();
    const variant_id = input.variant_id;

    const existing = await this.listBackInStockSubscriptions({
      email,
      variant_id,
      notified_at: null,
    });
    if (existing.length > 0) {
      return { id: existing[0].id, created: false };
    }

    const created = await this.createBackInStockSubscriptions({
      email,
      variant_id,
    });
    const row = Array.isArray(created) ? created[0] : created;
    return { id: row.id, created: true };
  }

  /**
   * All pending subscriptions for a given variant — caller is the
   * inventory subscriber that just observed stock > 0.
   */
  async listPendingForVariant(variant_id: string) {
    return this.listBackInStockSubscriptions({
      variant_id,
      notified_at: null,
    });
  }

  async markNotified(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date();
    await this.updateBackInStockSubscriptions(
      ids.map((id) => ({ id, notified_at: now })),
    );
  }
}

export default BackInStockModuleService;
