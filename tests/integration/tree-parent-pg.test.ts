import { setupIntegrationTestDb } from "./integration-harness.js";
import { defineTreeParentScenarios } from "./tree-parent-scenarios.js";

setupIntegrationTestDb();

defineTreeParentScenarios();
