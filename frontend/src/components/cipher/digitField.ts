export function createCypherDigitField(cols: number, rows: number): string[] {
  return Array.from({ length: cols * rows }, (_, index) => {
    let value = Math.imul((index + 1) ^ 0x9e3779b9, 0x85ebca6b);
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
    value ^= value >>> 16;
    return value & 1 ? '1' : '0';
  });
}
