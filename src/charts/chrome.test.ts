import {describe, expect, it} from 'vitest';
import {MARK, MAX_LABEL_CHARS, fitBand, truncateLabel} from './chrome';

describe('fitBand', () => {
  it('caps a wide band so the bar never fills its slot', () => {
    const {thickness, offset} = fitBand(80);
    expect(thickness).toBe(MARK.maxThickness);
    // The leftover is split evenly, so the bar sits centred in its band.
    expect(offset).toBe((80 - MARK.maxThickness) / 2);
  });

  it('uses the whole band when it is already narrower than the cap', () => {
    expect(fitBand(10)).toEqual({thickness: 10, offset: 0});
  });

  it('never returns a negative offset that would push a bar out of its band', () => {
    for (const bandwidth of [0, 1, 12, 24, 25, 400]) {
      expect(fitBand(bandwidth).offset).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('truncateLabel', () => {
  it('leaves a label that already fits completely alone', () => {
    expect(truncateLabel('Food')).toBe('Food');
    expect(truncateLabel('Transportation')).toBe('Transportation');
  });

  it('ellipsises a long label without exceeding the budget', () => {
    const result = truncateLabel('Other (7 categories)');
    expect(result).toBe('Other (7 catego…');
    // The ellipsis replaces a character rather than being appended past the
    // cap, so the rendered width stays inside the label column.
    expect(result.length).toBe(MAX_LABEL_CHARS);
  });

  it('does not leave a space stranded before the ellipsis', () => {
    // The cut lands on a space, which would otherwise render as "drink …".
    expect(truncateLabel('Food and drink out')).toBe('Food and drink…');
  });
});
