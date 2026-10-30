import { describe, expect, it } from "vitest";
import { formatValueDe, labNameDe, unitDisplay } from "./format.ts";

describe("formatValueDe", () => {
  it("uses the precision of value and reference range", () => {
    expect(formatValueDe(1, 0.8, 1.2)).toBe("1,0");
    expect(formatValueDe(3.1)).toBe("3,1");
    expect(formatValueDe(245, 150, 400)).toBe("245");
    expect(formatValueDe(0.9, 0.85)).toBe("0,90");
    expect(formatValueDe(12)).toBe("12");
  });
});

describe("unitDisplay", () => {
  it("renders powers of ten and drops annotations", () => {
    expect(unitDisplay("10*9/L")).toBe("10⁹/L");
    expect(unitDisplay("10*12/L")).toBe("10¹²/L");
    expect(unitDisplay("{INR}")).toBe("");
    expect(unitDisplay("s")).toBe("s");
    expect(unitDisplay("g/L")).toBe("g/L");
  });
});

describe("labNameDe", () => {
  it("maps known LOINC codes and falls back otherwise", () => {
    expect(labNameDe("777-3", "Platelets")).toBe("Thrombozyten");
    expect(labNameDe("6301-6", "INR")).toBe("INR");
    expect(labNameDe("2951-2", "Sodium")).toBe("Natrium");
    expect(labNameDe("9999-9", "Something")).toBe("Something");
    expect(labNameDe(undefined, "Platelets")).toBe("Platelets");
  });
});
