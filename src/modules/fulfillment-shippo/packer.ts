/**
 * First-Fit Decreasing bin packer.
 *
 * Input: a flat list of physical units derived from cart line items
 * (with bundles expanded to their components).
 *
 * Output: one packed parcel per shipping box, where each parcel uses
 * the dims of the box template it was assigned to (NOT the summed item
 * dims). Carriers bill on parcel dims + total weight; using box-template
 * dims is what matches reality.
 *
 * Algorithm is deliberately weight-based with a longest-dim sanity check
 * — not true 3D bin-packing. Occasional over-quote is acceptable;
 * weight-capped templates eliminate under-quote risk.
 */

export type ParcelUnit = {
  sku: string;
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
};

export type BoxTemplate = {
  id: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  maxWeightOz: number;
};

export type PackedParcel = {
  template: BoxTemplate;
  weightOz: number;
  units: ParcelUnit[];
};

/**
 * Box templates. Ordered smallest-first so the packer greedily picks the
 * tightest container that fits a new item. All templates are sized under
 * the strictest carrier limits (USPS Ground Advantage / Priority: 70 lb,
 * 130" length+girth) so every packed parcel is shippable by every
 * carrier we offer.
 *
 * The RIFLE template exists for long, narrow items (training rifles) that
 * can't fit in any cube-shaped box but ship easily in a long/narrow
 * carton. Length+girth = 42 + 2(14+8) = 86, well under 130.
 */
export const BOX_TEMPLATES: BoxTemplate[] = [
  { id: "SM",    lengthIn: 12, widthIn: 10, heightIn: 8,  maxWeightOz: 80 },   //  5 lb
  { id: "MD",    lengthIn: 18, widthIn: 14, heightIn: 10, maxWeightOz: 320 },  // 20 lb
  { id: "LG",    lengthIn: 24, widthIn: 18, heightIn: 12, maxWeightOz: 640 },  // 40 lb
  { id: "XL",    lengthIn: 30, widthIn: 20, heightIn: 16, maxWeightOz: 960 },  // 60 lb
  { id: "RIFLE", lengthIn: 42, widthIn: 14, heightIn: 8,  maxWeightOz: 240 },  // 15 lb
];

export class ParcelTooLargeError extends Error {
  constructor(sku: string, unit: ParcelUnit) {
    super(
      `SKU ${sku} does not fit in any box template ` +
        `(${unit.lengthIn}×${unit.widthIn}×${unit.heightIn}in, ${unit.weightOz}oz). ` +
        `Add an oversized template or review product dims.`
    );
    this.name = "ParcelTooLargeError";
  }
}

function longestDim(u: { lengthIn: number; widthIn: number; heightIn: number }): number {
  return Math.max(u.lengthIn, u.widthIn, u.heightIn);
}

function unitFitsInTemplate(unit: ParcelUnit, tmpl: BoxTemplate): boolean {
  return (
    unit.weightOz <= tmpl.maxWeightOz &&
    longestDim(unit) <= longestDim(tmpl)
  );
}

function smallestTemplateFor(unit: ParcelUnit): BoxTemplate | null {
  for (const tmpl of BOX_TEMPLATES) {
    if (unitFitsInTemplate(unit, tmpl)) return tmpl;
  }
  return null;
}

/**
 * Pack units into the minimum number of parcels using First Fit Decreasing
 * by weight. For each unit, reuse an existing open parcel if the unit's
 * weight still fits and its longest dim fits the parcel's template;
 * otherwise open a new parcel sized to the smallest template the unit
 * fits in.
 */
export function packUnitsIntoParcels(units: ParcelUnit[]): PackedParcel[] {
  const sorted = [...units].sort((a, b) => b.weightOz - a.weightOz);
  const parcels: PackedParcel[] = [];

  for (const unit of sorted) {
    let placed = false;
    for (const parcel of parcels) {
      const wouldWeigh = parcel.weightOz + unit.weightOz;
      if (
        wouldWeigh <= parcel.template.maxWeightOz &&
        longestDim(unit) <= longestDim(parcel.template)
      ) {
        parcel.weightOz = wouldWeigh;
        parcel.units.push(unit);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const tmpl = smallestTemplateFor(unit);
      if (!tmpl) throw new ParcelTooLargeError(unit.sku, unit);
      parcels.push({
        template: tmpl,
        weightOz: unit.weightOz,
        units: [unit],
      });
    }
  }

  return parcels;
}
