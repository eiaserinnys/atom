import { expect, test } from 'vitest';
import { mouseSensorOptions, touchSensorOptions } from './useTreeDragAndDrop';

test('drag sensors use mouse distance and touch long-press activation constraints', () => {
  expect(mouseSensorOptions).toEqual({ activationConstraint: { distance: 8 } });
  expect(touchSensorOptions).toEqual({ activationConstraint: { delay: 400, tolerance: 8 } });
});
