import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import TaxJarProviderService from "./service";

export default ModuleProvider(Modules.TAX, {
  services: [TaxJarProviderService],
});
