import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import FluidPayProviderService from "./service";

export default ModuleProvider(Modules.PAYMENT, {
  services: [FluidPayProviderService],
});
