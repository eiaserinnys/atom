import { setupIntegrationTestDb } from "./integration-harness.js";
import { defineDeletionScenarios } from "./deletion-scenarios.js";

setupIntegrationTestDb();

defineDeletionScenarios();
