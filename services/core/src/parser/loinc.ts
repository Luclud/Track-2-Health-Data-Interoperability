// LOINC codes: "<digits>-<check digit>", check digit = mod 10 (Luhn) over the digits.

export function loincCheckDigit(base: string): number {
  let sum = 0;
  const digits = base.split("").reverse();
  digits.forEach((ch, i) => {
    let n = Number(ch);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  });
  return (10 - (sum % 10)) % 10;
}

export function isValidLoinc(code: string): boolean {
  const m = /^(\d{1,7})-(\d)$/.exec(code.trim());
  if (!m) return false;
  return loincCheckDigit(m[1]!) === Number(m[2]);
}
