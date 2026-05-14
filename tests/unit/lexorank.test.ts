import {
  posToKey,
  keyToPos,
  compareKeys,
  keyBetween,
  rekeyEvenly,
  NORMAL_ALPHABET,
  PARK_GROUP_PREFIX,
  PARK_NONGROUP_PREFIX,
} from "../../src/shared/lexorank.js";

describe("lexorank — alphabet constants", () => {
  it("NORMAL_ALPHABET is byte-wise ordered ASCII digits", () => {
    expect(NORMAL_ALPHABET).toBe("0123456789");
    // Byte-wise monotone check
    for (let i = 1; i < NORMAL_ALPHABET.length; i++) {
      expect(NORMAL_ALPHABET.charCodeAt(i - 1)).toBeLessThan(
        NORMAL_ALPHABET.charCodeAt(i)
      );
    }
  });

  it("park prefixes sort before normal alphabet (PARK_GROUP < PARK_NONGROUP < '0')", () => {
    // 0x21 = '!', 0x22 = '"', 0x30 = '0'
    expect(PARK_GROUP_PREFIX.charCodeAt(0)).toBe(0x21);
    expect(PARK_NONGROUP_PREFIX.charCodeAt(0)).toBe(0x22);
    expect(PARK_GROUP_PREFIX.charCodeAt(0)).toBeLessThan(
      PARK_NONGROUP_PREFIX.charCodeAt(0)
    );
    expect(PARK_NONGROUP_PREFIX.charCodeAt(0)).toBeLessThan("0".charCodeAt(0));
  });
});

describe("lexorank — posToKey / keyToPos (positive)", () => {
  // T1
  it("T1: posToKey(100) === '0000000100'", () => {
    expect(posToKey(100)).toBe("0000000100");
  });

  // T2
  it("T2: posToKey(0) === '0000000000'", () => {
    expect(posToKey(0)).toBe("0000000000");
  });

  // T3
  it("T3: posToKey(INTEGER_MAX) === '2147483647'", () => {
    expect(posToKey(2147483647)).toBe("2147483647");
  });

  // T4
  it("T4: keyToPos('0000000100') === 100", () => {
    expect(keyToPos("0000000100")).toBe(100);
  });

  // T5
  it.each([0, 1, 100, 999999, 2147483647])(
    "T5: round-trip keyToPos(posToKey(%s)) === %s",
    (n) => {
      expect(keyToPos(posToKey(n))).toBe(n);
    }
  );
});

describe("lexorank — park (negative) territory", () => {
  // T6
  it("T6: posToKey(-2_000_000_000) === '!0000000000' (magnitude 0 zero-padded)", () => {
    expect(posToKey(-2_000_000_000)).toBe("!0000000000");
  });

  it("T6: keyToPos throws on park-group key", () => {
    expect(() => keyToPos("!0000000000")).toThrow();
    expect(() => keyToPos(posToKey(-2_000_000_000))).toThrow();
  });

  // T7
  it("T7: posToKey(-1_000_000_000) starts with '\"' (park-nongroup prefix)", () => {
    const key = posToKey(-1_000_000_000);
    expect(key.startsWith(PARK_NONGROUP_PREFIX)).toBe(true);
    expect(key).toHaveLength(11); // 1 prefix + 10 digits
  });

  it("T7: park-nongroup magnitude increases monotonically", () => {
    // -1_000_000_000 + i for i = 0..3
    const keys = [
      posToKey(-1_000_000_000),
      posToKey(-1_000_000_000 + 1),
      posToKey(-1_000_000_000 + 2),
      posToKey(-1_000_000_000 + 3),
    ];
    // byte-wise ascending
    for (let i = 1; i < keys.length; i++) {
      expect(compareKeys(keys[i - 1], keys[i])).toBeLessThan(0);
    }
  });
});

describe("lexorank — input guards (T8)", () => {
  it("posToKey throws on NaN", () => {
    expect(() => posToKey(NaN)).toThrow();
  });

  it("posToKey throws on non-integer (3.14)", () => {
    expect(() => posToKey(3.14)).toThrow();
  });

  it("posToKey throws on out-of-range positive (2^32)", () => {
    expect(() => posToKey(Math.pow(2, 32))).toThrow();
  });

  it("posToKey throws on out-of-range negative (below INTEGER_MIN)", () => {
    expect(() => posToKey(-Math.pow(2, 32))).toThrow();
  });

  it("posToKey throws on Infinity", () => {
    expect(() => posToKey(Infinity)).toThrow();
    expect(() => posToKey(-Infinity)).toThrow();
  });
});

describe("lexorank — compareKeys (T9, T10, T11)", () => {
  // T9
  it("T9: compareKeys orders positive zero-padded keys correctly", () => {
    expect(compareKeys("0000000100", "0000000200")).toBeLessThan(0);
    expect(compareKeys("0000000100", "0000000099")).toBeGreaterThan(0);
    expect(compareKeys("0000000100", "0000000100")).toBe(0);
  });

  // T10
  it("T10: park-group key < normal key (byte-wise)", () => {
    expect(compareKeys("!0000000000", "0000000000")).toBeLessThan(0);
    expect(compareKeys(posToKey(-2_000_000_000), posToKey(0))).toBeLessThan(0);
  });

  // T11
  it("T11: park-group < park-nongroup < normal", () => {
    const group = posToKey(-2_000_000_000);
    const nongroup = posToKey(-1_000_000_000);
    const normal = posToKey(0);
    expect(compareKeys(group, nongroup)).toBeLessThan(0);
    expect(compareKeys(nongroup, normal)).toBeLessThan(0);
  });
});

describe("lexorank — keyBetween (T12, T13, T14)", () => {
  // T12
  it("T12: keyBetween produces a key strictly between two non-adjacent keys", () => {
    const k = keyBetween("0000000100", "0000000200");
    expect(compareKeys("0000000100", k)).toBeLessThan(0);
    expect(compareKeys(k, "0000000200")).toBeLessThan(0);
  });

  // T13
  it("T13: keyBetween extends digit count for adjacent keys", () => {
    const k = keyBetween("0000000100", "0000000101");
    expect(compareKeys("0000000100", k)).toBeLessThan(0);
    expect(compareKeys(k, "0000000101")).toBeLessThan(0);
    // The fractional key must extend beyond 10 digits
    expect(k.length).toBeGreaterThan(10);
  });

  // T14
  it("T14: keyBetween(null, k) produces a key smaller than k", () => {
    const k = keyBetween(null, "0000000200");
    expect(compareKeys(k, "0000000200")).toBeLessThan(0);
  });

  it("T14: keyBetween(k, null) produces a key larger than k", () => {
    const k = keyBetween("0000000100", null);
    expect(compareKeys("0000000100", k)).toBeLessThan(0);
  });

  it("T14: keyBetween(null, null) is valid (initial key)", () => {
    const k = keyBetween(null, null);
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
  });

  it("keyBetween throws if a >= b (input order violated)", () => {
    expect(() => keyBetween("0000000200", "0000000100")).toThrow();
    expect(() => keyBetween("0000000100", "0000000100")).toThrow();
  });
});

describe("lexorank — rekeyEvenly (T15)", () => {
  // T15
  it("T15: rekeyEvenly(5) returns 5 distinct ascending keys", () => {
    const keys = rekeyEvenly(5);
    expect(keys).toHaveLength(5);
    // ascending
    for (let i = 1; i < keys.length; i++) {
      expect(compareKeys(keys[i - 1], keys[i])).toBeLessThan(0);
    }
    // distinct
    expect(new Set(keys).size).toBe(5);
  });

  it("rekeyEvenly(1) returns single key", () => {
    expect(rekeyEvenly(1)).toHaveLength(1);
  });

  it("rekeyEvenly(0) returns empty", () => {
    expect(rekeyEvenly(0)).toHaveLength(0);
  });
});

describe("lexorank — defense against fractional-key leakage (T16)", () => {
  // T16
  it("T16: keyToPos throws on fractional key (extended digits)", () => {
    // A keyBetween output that has extra digits beyond zero-padded 10
    const fractional = keyBetween("0000000100", "0000000101");
    expect(fractional.length).toBeGreaterThan(10);
    expect(() => keyToPos(fractional)).toThrow();
  });

  it("keyToPos throws on too-short key", () => {
    expect(() => keyToPos("100")).toThrow();
    expect(() => keyToPos("")).toThrow();
  });

  it("keyToPos throws on non-digit characters in normal-length key", () => {
    expect(() => keyToPos("000000010A")).toThrow();
    expect(() => keyToPos("0000000-50")).toThrow();
  });
});

describe("lexorank — byte-wise sort consistency (T17)", () => {
  // T17
  it("T17: [posToKey(1), posToKey(10), posToKey(2)].sort(compareKeys) matches integer sort", () => {
    const integers = [1, 10, 2, 100, 50, 999, 7];
    const keys = integers.map(posToKey);
    const sortedKeys = [...keys].sort(compareKeys);
    const expectedKeys = [...integers].sort((a, b) => a - b).map(posToKey);
    expect(sortedKeys).toEqual(expectedKeys);
  });

  it("T17: byte-wise sort across mixed positive and park territory", () => {
    const items = [
      posToKey(100),
      posToKey(-2_000_000_000),
      posToKey(0),
      posToKey(-1_000_000_000),
      posToKey(50),
    ];
    const sorted = [...items].sort(compareKeys);
    // Order: park-group(-2B) < park-nongroup(-1B) < 0 < 50 < 100
    expect(sorted[0]).toBe(posToKey(-2_000_000_000));
    expect(sorted[1]).toBe(posToKey(-1_000_000_000));
    expect(sorted[2]).toBe(posToKey(0));
    expect(sorted[3]).toBe(posToKey(50));
    expect(sorted[4]).toBe(posToKey(100));
  });
});
