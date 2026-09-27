import { createJevProvider, JEV_MODEL } from "./providers/jev-provider.js";
import { createLayaProvider, LAYA_MODEL, LAYA_MODELS } from "./providers/laya-provider.js";
import { DIRECTIONS, PROVIDER_IDS, validateDecisionPayload } from "./providers/provider-utils.js";

export { DIRECTIONS, JEV_MODEL, LAYA_MODEL, LAYA_MODELS, PROVIDER_IDS, validateDecisionPayload };

export function createDecisionProvider(options = {}) {
  if (options.id === "jev") return createJevProvider(options);
  if (options.id === "laya") return createLayaProvider(options);
  throw new TypeError(`Unsupported decision provider: ${options.id}`);
}

export function createDecisionProviders({ jevClient, layaClient } = {}) {
  return {
    jev: createJevProvider({ client: jevClient }),
    laya: createLayaProvider({ client: layaClient }),
  };
}

export function createJevService(options = {}) {
  return createJevProvider(options);
}
