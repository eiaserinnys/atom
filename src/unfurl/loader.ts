import type { AdapterRegistry } from "./registry.js";

export async function loadAdapters(registry: AdapterRegistry): Promise<void> {
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
