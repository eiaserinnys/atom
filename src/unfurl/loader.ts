import type { AdapterRegistry } from "./registry.js";
import { trelloAdapter } from "./adapters/trello/index.js";

export async function loadAdapters(registry: AdapterRegistry): Promise<void> {
  // Register built-in adapters
  registry.register(trelloAdapter);

  // Load external adapter packages from environment
  const packages = process.env["ADAPTER_PACKAGES"]?.split(",").map((p) => p.trim()) ?? [];
  for (const pkg of packages) {
    try {
      const mod = await import(pkg);
      if (typeof mod.register === "function") {
        mod.register(registry);
      } else {
        console.error(`[unfurl] Package "${pkg}" does not export a register() function`);
      }
    } catch (e) {
      console.error(`[unfurl] Failed to load adapter package: ${pkg}`, e);
    }
  }
}
