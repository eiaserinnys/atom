import type { CredentialField, UnfurlAdapter } from "./interface.js";

export class AdapterRegistry {
  private adapters = new Map<string, UnfurlAdapter>();

  register(adapter: UnfurlAdapter): void {
    this.adapters.set(adapter.sourceType, adapter);
  }

  find(sourceType: string): UnfurlAdapter | undefined {
    return this.adapters.get(sourceType);
  }

  list(): { sourceType: string; credentialFields: CredentialField[] }[] {
    return Array.from(this.adapters.values()).map((adapter) => ({
      sourceType: adapter.sourceType,
      credentialFields: adapter.credentialFields,
    }));
  }
}

export const adapterRegistry = new AdapterRegistry();
