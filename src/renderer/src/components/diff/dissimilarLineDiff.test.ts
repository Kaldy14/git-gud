import { describe, expect, it } from 'vitest';

import { lineSimilarity } from './dissimilarLineDiff';

describe('lineSimilarity', () => {
  it('treats code replaced by an unrelated comment as dissimilar', () => {
    expect(lineSimilarity(
      '  const webViewRef = useRef<WebView>(null)',
      '  // WebView 14 defaults its extra props to undefined, making the intersection never.'
    )).toBeLessThan(0.5);
  });

  it('keeps edited lines that share most of their tokens similar', () => {
    expect(lineSimilarity(
      '  const otpInputRef = useRef<TextInput>(null)',
      '  const otpInputRef = useRef<TextInputInstance>(null)'
    )).toBeGreaterThan(0.8);
  });
});
