export const DEPTH_SLIDER_KEY = 'atom-compile-depth';
export const DEFAULT_SLIDER = 5;
export const INFINITY_SLIDER_VALUE = 10;

export function parseStoredDepthSlider(stored: string | null): number {
  const parsed = stored ? parseInt(stored, 10) : NaN;
  return isNaN(parsed) ? DEFAULT_SLIDER : Math.min(INFINITY_SLIDER_VALUE, Math.max(1, parsed));
}

export function sliderToDepth(value: number): number {
  return value === INFINITY_SLIDER_VALUE ? Infinity : value;
}

export function formatDepthLabel(value: number): string {
  return value === INFINITY_SLIDER_VALUE ? '∞' : String(value);
}
