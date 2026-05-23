import { describe, expect, test } from 'vitest';
import {
  DEFAULT_SLIDER,
  DEPTH_SLIDER_KEY,
  INFINITY_SLIDER_VALUE,
  formatDepthLabel,
  parseStoredDepthSlider,
  sliderToDepth,
} from './compileDepth';

describe('compile depth slider logic', () => {
  test('keeps the existing storage key and default slider value', () => {
    expect(DEPTH_SLIDER_KEY).toBe('atom-compile-depth');
    expect(DEFAULT_SLIDER).toBe(5);
  });

  test('parses stored slider values with the existing clamp behavior', () => {
    expect(parseStoredDepthSlider(null)).toBe(DEFAULT_SLIDER);
    expect(parseStoredDepthSlider('')).toBe(DEFAULT_SLIDER);
    expect(parseStoredDepthSlider('abc')).toBe(DEFAULT_SLIDER);
    expect(parseStoredDepthSlider('-4')).toBe(1);
    expect(parseStoredDepthSlider('0')).toBe(1);
    expect(parseStoredDepthSlider('7')).toBe(7);
    expect(parseStoredDepthSlider('99')).toBe(INFINITY_SLIDER_VALUE);
  });

  test('maps the max slider value to Infinity and labels it as infinity', () => {
    expect(sliderToDepth(1)).toBe(1);
    expect(sliderToDepth(9)).toBe(9);
    expect(sliderToDepth(INFINITY_SLIDER_VALUE)).toBe(Infinity);
    expect(formatDepthLabel(9)).toBe('9');
    expect(formatDepthLabel(INFINITY_SLIDER_VALUE)).toBe('∞');
  });
});
