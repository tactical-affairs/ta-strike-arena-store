import { Module } from "@medusajs/framework/utils";
import ProcurementModuleService from "./service";

export const PROCUREMENT_MODULE = "procurement";

export default Module(PROCUREMENT_MODULE, {
  service: ProcurementModuleService,
});
