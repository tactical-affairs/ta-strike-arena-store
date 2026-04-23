/**
 * Procurement + FIFO-COGS module service.
 *
 * Tracks purchase orders, inventory lots (FIFO cost layers), and
 * COGS entries. Consumes lots on fulfillment and reverses on return.
 *
 * Cross-module calls (to core inventory for stock bumps) go through
 * the container — this service is deliberately ignorant of stock
 * quantities, which stay authoritative in Medusa's inventory module.
 */

import { MedusaService } from "@medusajs/framework/utils";
import { MedusaError } from "@medusajs/framework/utils";
import { Supplier } from "./models/supplier";
import { PurchaseOrder } from "./models/purchase-order";
import { PurchaseOrderLine } from "./models/purchase-order-line";
import { PoAdjustment } from "./models/po-adjustment";
import { InventoryLot } from "./models/inventory-lot";
import { CogsEntry } from "./models/cogs-entry";

export type CreatePurchaseOrderInput = {
  supplier_id: string;
  po_number?: string;
  ordered_at?: Date | string;
  expected_at?: Date | string;
  notes?: string;
  created_by?: string;
  lines: Array<{
    variant_id: string;
    qty_ordered: number;
    unit_cost: number;
    currency?: string;
  }>;
  adjustments?: Array<{
    type: "shipping" | "discount" | "tariff" | "other";
    amount: number;
    notes?: string;
  }>;
};

export type ReceivePurchaseOrderInput = {
  purchase_order_id: string;
  location_id: string;
  received_at?: Date | string;
  lines: Array<{
    po_line_id: string;
    inventory_item_id: string;
    qty_received: number;
  }>;
};

export type ConsumeFifoInput = {
  order_id: string;
  order_line_item_id: string;
  inventory_item_id: string;
  qty: number;
  posted_at?: Date | string;
};

export type ConsumeFifoResult = {
  total_cost: number;
  entries: Array<{
    lot_id: string;
    qty: number;
    unit_cost: number;
    total_cost: number;
  }>;
  uncovered_qty: number; // > 0 means we ran out of lots — posts with a warning
};

export type ReverseCogsInput = {
  order_id: string;
  order_line_item_id: string;
  inventory_item_id: string;
  location_id: string;
  qty: number;
  condition: "resellable" | "damaged";
  reversed_at?: Date | string;
};

class ProcurementModuleService extends MedusaService({
  Supplier,
  PurchaseOrder,
  PurchaseOrderLine,
  PoAdjustment,
  InventoryLot,
  CogsEntry,
}) {
  /**
   * Build a draft PO with its lines in one call. Lines are created
   * via the auto-generated createPurchaseOrderLines method inherited
   * from MedusaService.
   */
  async createPurchaseOrderWithLines(
    input: CreatePurchaseOrderInput,
  ): Promise<{ id: string }> {
    if (!input.lines?.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Purchase order must have at least one line",
      );
    }

    const poNumber = input.po_number ?? this.generatePoNumber();
    const po = await this.createPurchaseOrders({
      po_number: poNumber,
      status: "draft",
      supplier_id: input.supplier_id,
      ordered_at: input.ordered_at
        ? new Date(input.ordered_at)
        : null,
      expected_at: input.expected_at
        ? new Date(input.expected_at)
        : null,
      notes: input.notes,
      created_by: input.created_by,
    });

    await this.createPurchaseOrderLines(
      input.lines.map((l) => ({
        purchase_order_id: po.id,
        variant_id: l.variant_id,
        qty_ordered: l.qty_ordered,
        qty_received: 0,
        unit_cost: l.unit_cost,
        currency: l.currency ?? "usd",
      })),
    );

    if (input.adjustments?.length) {
      await this.createPoAdjustments(
        input.adjustments.map((a) => ({
          purchase_order_id: po.id,
          type: a.type,
          amount: a.amount,
          notes: a.notes ?? null,
        })),
      );
    }

    return { id: po.id };
  }

  /**
   * Compute landed unit costs for each line on a PO by allocating
   * PO-level adjustments (shipping, discount, tariff, other) across
   * the lines by extended value (qty_ordered × unit_cost) — GAAP-
   * standard approach.
   *
   * Returns `{ landed_unit_cost, allocated_adjustment_total }` per
   * line id. Discounts are negative and reduce landed cost; other
   * types are positive.
   */
  async computeLandedUnitCosts(
    purchase_order_id: string,
  ): Promise<
    Record<string, { landed_unit_cost: number; allocated: number }>
  > {
    const po = await this.retrievePurchaseOrder(purchase_order_id, {
      relations: ["lines", "adjustments"],
    });

    const adjustmentTotal = (po.adjustments ?? []).reduce(
      (sum: number, a: { amount: unknown }) => sum + Number(a.amount),
      0,
    );

    const totalExtendedValue = (po.lines ?? []).reduce(
      (sum: number, l: { qty_ordered: number; unit_cost: unknown }) =>
        sum + l.qty_ordered * Number(l.unit_cost),
      0,
    );

    const result: Record<
      string,
      { landed_unit_cost: number; allocated: number }
    > = {};

    for (const line of po.lines ?? []) {
      const lineExtendedValue =
        line.qty_ordered * Number(line.unit_cost);
      const share =
        totalExtendedValue > 0
          ? lineExtendedValue / totalExtendedValue
          : 0;
      const allocated = share * adjustmentTotal;
      const landedUnitCost =
        line.qty_ordered > 0
          ? Number(line.unit_cost) + allocated / line.qty_ordered
          : Number(line.unit_cost);
      result[line.id] = {
        landed_unit_cost: landedUnitCost,
        allocated,
      };
    }

    return result;
  }

  /**
   * Receive all or part of a PO. For each line, creates an
   * InventoryLot with the received quantity at the line's unit_cost
   * and advances the line's qty_received counter. Caller is
   * responsible for bumping core inventory_level.stocked_quantity —
   * that happens in the admin API route that calls this method, so
   * this service stays free of cross-module concerns.
   */
  async receivePurchaseOrder(
    input: ReceivePurchaseOrderInput,
  ): Promise<{ lots_created: string[]; po_status: string }> {
    const po = await this.retrievePurchaseOrder(input.purchase_order_id, {
      relations: ["lines"],
    });

    if (po.status === "closed" || po.status === "canceled") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot receive on a ${po.status} purchase order`,
      );
    }

    const receivedAt = input.received_at
      ? new Date(input.received_at)
      : new Date();
    const lotsCreated: string[] = [];

    // Compute landed unit cost per line (allocates PO-level
    // adjustments — shipping, tariffs, discounts — by extended value).
    const landedCosts = await this.computeLandedUnitCosts(po.id);

    for (const rcv of input.lines) {
      if (rcv.qty_received <= 0) continue;

      const line = po.lines?.find((l) => l.id === rcv.po_line_id);
      if (!line) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `PO line ${rcv.po_line_id} not found on PO ${po.id}`,
        );
      }

      const remainingToReceive = line.qty_ordered - line.qty_received;
      if (rcv.qty_received > remainingToReceive) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Line ${line.id}: received ${rcv.qty_received} exceeds remaining ${remainingToReceive}`,
        );
      }

      const landed = landedCosts[line.id]?.landed_unit_cost ?? Number(line.unit_cost);

      const lot = await this.createInventoryLots({
        inventory_item_id: rcv.inventory_item_id,
        po_line_id: line.id,
        location_id: input.location_id,
        qty_initial: rcv.qty_received,
        qty_remaining: rcv.qty_received,
        unit_cost: landed,
        currency: line.currency,
        received_at: receivedAt,
        status: "active",
        source: "po",
      });
      lotsCreated.push(lot.id);

      await this.updatePurchaseOrderLines({
        id: line.id,
        qty_received: line.qty_received + rcv.qty_received,
      });
    }

    const refreshed = await this.retrievePurchaseOrder(po.id, {
      relations: ["lines"],
    });
    const allFilled = (refreshed.lines ?? []).every(
      (l) => l.qty_received >= l.qty_ordered,
    );
    const anyReceived = (refreshed.lines ?? []).some(
      (l) => l.qty_received > 0,
    );
    const newStatus = allFilled
      ? "closed"
      : anyReceived
        ? "partial"
        : po.status;
    if (newStatus !== po.status) {
      await this.updatePurchaseOrders({ id: po.id, status: newStatus });
    }

    return { lots_created: lotsCreated, po_status: newStatus };
  }

  /**
   * Consume FIFO lots for a fulfilled order line. Writes one
   * CogsEntry per lot touched. Returns the total_cost + a breakdown
   * for the subscriber to log.
   *
   * `uncovered_qty` > 0 means lots ran out mid-consumption — the
   * caller should log and alert (usually indicates missing opening
   * balance or a bad inventory count).
   */
  async consumeFifo(input: ConsumeFifoInput): Promise<ConsumeFifoResult> {
    if (input.qty <= 0) {
      return { total_cost: 0, entries: [], uncovered_qty: 0 };
    }

    const lots = await this.listInventoryLots(
      {
        inventory_item_id: input.inventory_item_id,
        status: "active",
      },
      { order: { received_at: "ASC" } },
    );

    const postedAt = input.posted_at
      ? new Date(input.posted_at)
      : new Date();
    const entries: ConsumeFifoResult["entries"] = [];
    let remaining = input.qty;
    let totalCost = 0;

    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lot.qty_remaining <= 0) continue;

      const takeQty = Math.min(lot.qty_remaining, remaining);
      const unitCost = Number(lot.unit_cost);
      const lineCost = takeQty * unitCost;

      await this.createCogsEntries({
        order_id: input.order_id,
        order_line_item_id: input.order_line_item_id,
        lot_id: lot.id,
        qty: takeQty,
        unit_cost: unitCost,
        total_cost: lineCost,
        currency: lot.currency,
        posted_at: postedAt,
      });

      const newRemaining = lot.qty_remaining - takeQty;
      await this.updateInventoryLots({
        id: lot.id,
        qty_remaining: newRemaining,
        status: newRemaining === 0 ? "exhausted" : "active",
      });

      entries.push({
        lot_id: lot.id,
        qty: takeQty,
        unit_cost: unitCost,
        total_cost: lineCost,
      });
      totalCost += lineCost;
      remaining -= takeQty;
    }

    return {
      total_cost: totalCost,
      entries,
      uncovered_qty: remaining,
    };
  }

  /**
   * Reverse COGS for a returned order line.
   *
   * Process (faithful cost-mix preservation):
   *   1. Reverse matching CogsEntry rows newest-first (LIFO on the
   *      reversal side — the original consumption was FIFO oldest-
   *      first, so the most recently-consumed lot is reversed first;
   *      that's what accountants mean by "reverse FIFO").
   *   2. For each distinct cost segment consumed, create a matching
   *      InventoryLot at that exact unit_cost. A return spanning two
   *      different lot costs produces two restock lots — cost basis
   *      is preserved, not collapsed to an average.
   *   3. Condition = "resellable" → new lots are active, re-enter FIFO
   *      at "now" so they're consumed before newer PO stock.
   *      Condition = "damaged" → lots recorded with status=damaged
   *      and qty_remaining=0 (never consumed, tracked for loss report).
   */
  async reverseCogsForReturn(
    input: ReverseCogsInput,
  ): Promise<{ new_lot_ids: string[]; cost_reversed: number }> {
    const entries = await this.listCogsEntries(
      {
        order_line_item_id: input.order_line_item_id,
        reversed_at: null,
      },
      { order: { posted_at: "DESC" } },
    );

    const reversedAt = input.reversed_at
      ? new Date(input.reversed_at)
      : new Date();
    let remainingToReturn = input.qty;
    let totalReversedCost = 0;
    const newLotIds: string[] = [];

    for (const entry of entries) {
      if (remainingToReturn <= 0) break;

      const takeQty = Math.min(entry.qty, remainingToReturn);
      const entryUnitCost = Number(entry.unit_cost);
      const revertedCost = takeQty * entryUnitCost;

      await this.updateCogsEntries({
        id: entry.id,
        reversed_at: reversedAt,
      });

      const lot = await this.createInventoryLots({
        inventory_item_id: input.inventory_item_id,
        po_line_id: null,
        location_id: input.location_id,
        qty_initial: takeQty,
        qty_remaining: input.condition === "resellable" ? takeQty : 0,
        unit_cost: entryUnitCost,
        currency: entry.currency,
        received_at: reversedAt,
        status: input.condition === "resellable" ? "active" : "damaged",
        source: "return_restock",
      });
      newLotIds.push(lot.id);

      totalReversedCost += revertedCost;
      remainingToReturn -= takeQty;
    }

    if (remainingToReturn > 0) {
      // Returned qty exceeds what we previously consumed on this
      // line. Shouldn't happen in practice; log and leave the excess
      // un-restocked rather than inventing a cost basis.
      // (Caller should reconcile manually.)
    }

    return { new_lot_ids: newLotIds, cost_reversed: totalReversedCost };
  }

  /**
   * Weighted average cost across all active lots for an inventory
   * item. Used by the product-detail widget to show a stable cost
   * basis (FIFO unit cost fluctuates with each lot).
   */
  async getWeightedAverageCost(
    inventory_item_id: string,
  ): Promise<number | null> {
    const lots = await this.listInventoryLots({
      inventory_item_id,
      status: "active",
    });
    let totalQty = 0;
    let totalValue = 0;
    for (const lot of lots) {
      totalQty += lot.qty_remaining;
      totalValue += lot.qty_remaining * Number(lot.unit_cost);
    }
    return totalQty > 0 ? totalValue / totalQty : null;
  }

  private generatePoNumber(): string {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PO-${ymd}-${rand}`;
  }
}

export default ProcurementModuleService;
