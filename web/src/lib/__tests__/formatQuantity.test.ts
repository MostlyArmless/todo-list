import { formatQuantityTotal } from '../formatQuantity';

describe('formatQuantityTotal', () => {
  describe('basic input handling', () => {
    it('should return empty string for null input', () => {
      expect(formatQuantityTotal(null)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(formatQuantityTotal('')).toBe('');
    });

    it('should return original value when no + sign present', () => {
      expect(formatQuantityTotal('2 lbs')).toBe('2 lbs');
      expect(formatQuantityTotal('1/2 cup')).toBe('1/2 cup');
      expect(formatQuantityTotal('3')).toBe('3');
    });
  });

  describe('summing quantities with same units', () => {
    it('should sum simple numbers with units', () => {
      expect(formatQuantityTotal('2 lbs + 3 lbs')).toBe('5 lbs');
    });

    it('should sum decimal numbers with units', () => {
      expect(formatQuantityTotal('1.5 oz + 2.5 oz')).toBe('4 oz');
    });

    it('should sum fractions with same units', () => {
      expect(formatQuantityTotal('1/2 cup + 1/4 cup')).toBe('0.75 cup');
    });

    it('should sum plain numbers without units', () => {
      expect(formatQuantityTotal('2 + 3')).toBe('5');
    });

    it('should sum multiple quantities', () => {
      expect(formatQuantityTotal('1 lbs + 2 lbs + 3 lbs')).toBe('6 lbs');
    });

    it('should handle whitespace variations', () => {
      expect(formatQuantityTotal('2 lbs+3 lbs')).toBe('5 lbs');
      expect(formatQuantityTotal('2 lbs  +  3 lbs')).toBe('5 lbs');
    });
  });

  describe('unit normalization', () => {
    it('should treat units case-insensitively', () => {
      expect(formatQuantityTotal('2 LBS + 3 lbs')).toBe('5 lbs');
      expect(formatQuantityTotal('1 Cup + 1 CUP')).toBe('2 cup');
    });
  });

  describe('mixed units - cannot sum', () => {
    it('should return original when units differ', () => {
      expect(formatQuantityTotal('2 lbs + 3 oz')).toBe('2 lbs + 3 oz');
    });

    it('should return original when mixing unitless and unit quantities', () => {
      expect(formatQuantityTotal('2 + 3 lbs')).toBe('2 + 3 lbs');
    });
  });

  describe('non-parseable input', () => {
    it('should return original for non-numeric values', () => {
      expect(formatQuantityTotal('some + text')).toBe('some + text');
    });

    it('should return original for partially parseable input', () => {
      expect(formatQuantityTotal('2 lbs + some text')).toBe('2 lbs + some text');
    });

    it('should return original for empty parts after split', () => {
      expect(formatQuantityTotal('+ 2 lbs')).toBe('+ 2 lbs');
    });
  });

  describe('number formatting', () => {
    it('should format integers without decimal places', () => {
      expect(formatQuantityTotal('2.5 lbs + 2.5 lbs')).toBe('5 lbs');
    });

    it('should remove trailing zeros from decimals', () => {
      expect(formatQuantityTotal('1.25 cup + 1.25 cup')).toBe('2.5 cup');
    });

    it('should keep necessary decimal places', () => {
      expect(formatQuantityTotal('1/3 cup + 1/3 cup')).toBe('0.67 cup');
    });
  });

  describe('edge cases', () => {
    it('should handle single item with + in unit name', () => {
      // This is an edge case - if someone has a weird unit
      // The current implementation would try to parse it
      expect(formatQuantityTotal('2 c++')).toBe('2 c++');
    });

    it('should handle division by zero in fractions', () => {
      // Division by zero produces Infinity, which is a valid number
      // The function sums it as Infinity + 1 = Infinity
      expect(formatQuantityTotal('1/0 cup + 1 cup')).toBe('Infinity cup');
    });
  });
});
