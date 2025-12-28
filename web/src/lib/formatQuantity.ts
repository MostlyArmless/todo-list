/**
 * Utility function to parse and sum quantities intelligently.
 * Handles merged quantities like "2 lbs + 3 lbs" and fractions like "1/2 cup + 1/4 cup".
 */
export function formatQuantityTotal(quantity: string | null): string {
  if (!quantity) return '';

  // Check if it contains a '+' (merged quantities)
  if (!quantity.includes('+')) return quantity;

  const parts = quantity.split('+').map((p) => p.trim());

  // Try to parse each part
  const parsed: { value: number; unit: string }[] = [];
  let allParseable = true;

  for (const part of parts) {
    // Match patterns like "2", "2.5", "1/2", "2 lbs", "1.5 oz", "1/4 cup"
    const match = part.match(/^([\d.\/]+)\s*(.*)$/);
    if (match) {
      let value: number;
      const rawValue = match[1];
      const unit = match[2].toLowerCase().trim();

      // Handle fractions
      if (rawValue.includes('/')) {
        const [num, denom] = rawValue.split('/');
        value = parseFloat(num) / parseFloat(denom);
      } else {
        value = parseFloat(rawValue);
      }

      if (!isNaN(value)) {
        parsed.push({ value, unit });
      } else {
        allParseable = false;
        break;
      }
    } else {
      allParseable = false;
      break;
    }
  }

  if (!allParseable || parsed.length === 0) {
    // Fall back to original format
    return quantity;
  }

  // Check if all units are the same (or all empty for plain numbers)
  const units = [...new Set(parsed.map((p) => p.unit))];
  if (units.length === 1) {
    // All same unit, sum them
    const total = parsed.reduce((acc, p) => acc + p.value, 0);
    const unit = units[0];

    // Format the number nicely
    const formattedTotal = Number.isInteger(total) ? total.toString() : total.toFixed(2).replace(/\.?0+$/, '');

    return unit ? `${formattedTotal} ${unit}` : formattedTotal;
  }

  // Different units, can't sum - return original
  return quantity;
}
