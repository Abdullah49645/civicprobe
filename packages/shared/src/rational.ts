/**
 * Exact rational arithmetic over BigInt.
 *
 * Why this exists: the delta engine decides whether two policy versions agree
 * on an interval. With IEEE floats, 0.11 * 1_000_000 is 110000.00000000001 and
 * "is the difference zero?" becomes "is it smaller than some epsilon?", i.e. a
 * tolerance hidden inside the oracle. Statutory tables are exact decimals, so
 * CivicProbe evaluates them exactly and only converts to `number` at the edge
 * (display, comparison against an observed value under an explicit
 * tolerance). No epsilon decides whether a region is affected.
 */
export class Rational {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    if (d === 0n) throw new Error("Rational: zero denominator");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = g === 0n ? 0n : n / g;
    this.d = g === 0n ? 1n : d / g;
  }

  static of(n: bigint | number, d: bigint | number = 1n): Rational {
    const bn = typeof n === "number" ? BigInt(assertInteger(n)) : n;
    const bd = typeof d === "number" ? BigInt(assertInteger(d)) : d;
    return new Rational(bn, bd);
  }

  /** Parse an exact decimal string such as "0.35", "-12.5", "1424000". */
  static parse(s: string): Rational {
    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) throw new Error(`Rational.parse: not a plain decimal: ${JSON.stringify(s)}`);
    const frac = m[3] ?? "";
    const n = BigInt((m[1] ?? "") + m[2] + frac);
    return new Rational(n, 10n ** BigInt(frac.length));
  }

  static from(v: Rational | number | string): Rational {
    if (v instanceof Rational) return v;
    if (typeof v === "string") return Rational.parse(v);
    return Rational.of(v);
  }

  static readonly ZERO = new Rational(0n, 1n);
  static readonly ONE = new Rational(1n, 1n);

  add(o: Rational): Rational {
    return new Rational(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o: Rational): Rational {
    return new Rational(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o: Rational): Rational {
    return new Rational(this.n * o.n, this.d * o.d);
  }
  div(o: Rational): Rational {
    if (o.n === 0n) throw new Error("Rational: division by zero");
    return new Rational(this.n * o.d, this.d * o.n);
  }
  neg(): Rational {
    return new Rational(-this.n, this.d);
  }
  cmp(o: Rational): -1 | 0 | 1 {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  eq(o: Rational): boolean {
    return this.n === o.n && this.d === o.d;
  }
  isZero(): boolean {
    return this.n === 0n;
  }
  sign(): -1 | 0 | 1 {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }
  abs(): Rational {
    return this.n < 0n ? this.neg() : this;
  }
  /** Largest integer <= this. */
  floor(): bigint {
    const q = this.n / this.d;
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q;
  }
  /** Smallest integer >= this. */
  ceil(): bigint {
    const q = this.n / this.d;
    return this.n > 0n && q * this.d !== this.n ? q + 1n : q;
  }
  isInteger(): boolean {
    return this.d === 1n;
  }
  toNumber(): number {
    // Exact for the magnitudes CivicProbe handles (PKR amounts << 2^53 * d).
    const whole = this.n / this.d;
    const rem = this.n - whole * this.d;
    return Number(whole) + Number(rem) / Number(this.d);
  }
  /** Canonical string form "n/d" or "n" — used in hashed evidence. */
  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }
  /** Exact decimal string when the denominator divides a power of ten, else n/d. */
  toDecimalString(maxDigits = 12): string {
    let d = this.d;
    let twos = 0;
    let fives = 0;
    while (d % 2n === 0n) {
      d /= 2n;
      twos++;
    }
    while (d % 5n === 0n) {
      d /= 5n;
      fives++;
    }
    if (d !== 1n) return this.toString();
    const k = Math.max(twos, fives);
    if (k > maxDigits) return this.toString();
    const scaled = (this.n * 10n ** BigInt(k)) / this.d;
    const neg = scaled < 0n;
    const digits = (neg ? -scaled : scaled).toString().padStart(k + 1, "0");
    const int = digits.slice(0, digits.length - k);
    const frac = k > 0 ? "." + digits.slice(digits.length - k) : "";
    return (neg ? "-" : "") + int + frac;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function assertInteger(n: number): number {
  if (!Number.isSafeInteger(n)) throw new Error(`Rational: expected a safe integer, got ${n}`);
  return n;
}

export const R = Rational.from;
