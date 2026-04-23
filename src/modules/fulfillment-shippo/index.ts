import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import ShippoFulfillmentProviderService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ShippoFulfillmentProviderService],
});
