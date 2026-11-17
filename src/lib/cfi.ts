import ePub from 'epubjs';

let inst: any;
/** Compares two EPUB CFIs: -1, 0 or 1. Never throws. */
export function cfiCompare(a: string, b: string): number {
  try {
    inst ??= new (ePub as any).CFI();
    return inst.compare(a, b);
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}
