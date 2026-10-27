import { rmSync } from 'node:fs';

export default function teardown() {
  rmSync(process.env.ATOM_E2E_DIR!, { recursive: true, force: true });
}
