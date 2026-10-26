import { useCallback, useState } from 'react';
import {
  DEPTH_SLIDER_KEY,
  formatDepthLabel,
  parseStoredDepthSlider,
  sliderToDepth,
} from './compileDepth';

export function useCompileDepth() {
  const [sliderValue, setSliderValue] = useState<number>(() =>
    parseStoredDepthSlider(localStorage.getItem(DEPTH_SLIDER_KEY))
  );

  const selectDepth = useCallback((value: number) => {
    setSliderValue(value);
    localStorage.setItem(DEPTH_SLIDER_KEY, String(value));
  }, []);

  return {
    sliderValue,
    depth: sliderToDepth(sliderValue),
    depthLabel: formatDepthLabel(sliderValue),
    selectDepth,
  };
}
