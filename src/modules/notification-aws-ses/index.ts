import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import AwsSesNotificationProviderService from "./service";

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [AwsSesNotificationProviderService],
});
