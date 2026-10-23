/**
 * Unit conversion without a model (cost lever D7): "convert 5 km to miles",
 * "what is 72 °F in celsius", "how many feet in 3 miles".
 *
 * Registry data: each unit is a dimension, a factor to the dimension's base unit and
 * its spellings. Temperature is affine, so it converts through kelvin. Only units
 * whose meaning is not in dispute are listed: no "ton" (short / long / metric), no
 * "KB"/"GB" (1000 or 1024?), no months or years, no imperial gallon — `gallon` is the
 * US gallon and the answer says so. Both units must be known and of one dimension,
 * or the handler declines.
 */

import { formatNumber, normalizeQuestion, type DeterministicAnswer, type DeterministicHandler } from './types';

type Dimension = 'length' | 'mass' | 'volume' | 'time' | 'speed' | 'temperature';

interface Unit {
  dimension: Dimension;
  /** Singular / plural display names. */
  one: string;
  many: string;
  /** Multiply by this to reach the dimension's base unit (temperature: see `toKelvin`). */
  factor: number;
  spellings: readonly string[];
}

const UNITS: readonly Unit[] = [
  { dimension: 'length', one: 'millimeter', many: 'millimeters', factor: 0.001, spellings: ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'] },
  { dimension: 'length', one: 'centimeter', many: 'centimeters', factor: 0.01, spellings: ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'] },
  { dimension: 'length', one: 'meter', many: 'meters', factor: 1, spellings: ['m', 'meter', 'meters', 'metre', 'metres'] },
  { dimension: 'length', one: 'kilometer', many: 'kilometers', factor: 1000, spellings: ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'] },
  { dimension: 'length', one: 'inch', many: 'inches', factor: 0.0254, spellings: ['inch', 'inches'] },
  { dimension: 'length', one: 'foot', many: 'feet', factor: 0.3048, spellings: ['ft', 'foot', 'feet'] },
  { dimension: 'length', one: 'yard', many: 'yards', factor: 0.9144, spellings: ['yd', 'yard', 'yards'] },
  { dimension: 'length', one: 'mile', many: 'miles', factor: 1609.344, spellings: ['mi', 'mile', 'miles'] },
  { dimension: 'mass', one: 'milligram', many: 'milligrams', factor: 1e-6, spellings: ['mg', 'milligram', 'milligrams'] },
  { dimension: 'mass', one: 'gram', many: 'grams', factor: 0.001, spellings: ['g', 'gram', 'grams'] },
  { dimension: 'mass', one: 'kilogram', many: 'kilograms', factor: 1, spellings: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'] },
  { dimension: 'mass', one: 'tonne', many: 'tonnes', factor: 1000, spellings: ['tonne', 'tonnes'] },
  { dimension: 'mass', one: 'ounce', many: 'ounces', factor: 0.028349523125, spellings: ['oz', 'ounce', 'ounces'] },
  { dimension: 'mass', one: 'pound', many: 'pounds', factor: 0.45359237, spellings: ['lb', 'lbs', 'pound', 'pounds'] },
  { dimension: 'volume', one: 'milliliter', many: 'milliliters', factor: 0.001, spellings: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { dimension: 'volume', one: 'liter', many: 'liters', factor: 1, spellings: ['l', 'liter', 'liters', 'litre', 'litres'] },
  { dimension: 'volume', one: 'US gallon', many: 'US gallons', factor: 3.785411784, spellings: ['gal', 'gallon', 'gallons', 'us gallon', 'us gallons'] },
  { dimension: 'time', one: 'millisecond', many: 'milliseconds', factor: 0.001, spellings: ['ms', 'millisecond', 'milliseconds'] },
  { dimension: 'time', one: 'second', many: 'seconds', factor: 1, spellings: ['s', 'sec', 'secs', 'second', 'seconds'] },
  { dimension: 'time', one: 'minute', many: 'minutes', factor: 60, spellings: ['min', 'mins', 'minute', 'minutes'] },
  { dimension: 'time', one: 'hour', many: 'hours', factor: 3600, spellings: ['h', 'hr', 'hrs', 'hour', 'hours'] },
  { dimension: 'time', one: 'day', many: 'days', factor: 86_400, spellings: ['day', 'days'] },
  { dimension: 'time', one: 'week', many: 'weeks', factor: 604_800, spellings: ['week', 'weeks'] },
  { dimension: 'speed', one: 'meter per second', many: 'meters per second', factor: 1, spellings: ['m/s', 'meters per second', 'metres per second'] },
  { dimension: 'speed', one: 'kilometer per hour', many: 'kilometers per hour', factor: 1000 / 3600, spellings: ['km/h', 'kph', 'kmh', 'kilometers per hour', 'kilometres per hour'] },
  { dimension: 'speed', one: 'mile per hour', many: 'miles per hour', factor: 1609.344 / 3600, spellings: ['mph', 'miles per hour'] },
  { dimension: 'temperature', one: 'degree Celsius', many: 'degrees Celsius', factor: 1, spellings: ['c', '°c', 'celsius', 'degrees c', 'degrees celsius', 'degree celsius', 'centigrade'] },
  { dimension: 'temperature', one: 'degree Fahrenheit', many: 'degrees Fahrenheit', factor: 1, spellings: ['f', '°f', 'fahrenheit', 'degrees f', 'degrees fahrenheit', 'degree fahrenheit'] },
  { dimension: 'temperature', one: 'kelvin', many: 'kelvin', factor: 1, spellings: ['k', 'kelvin', 'kelvins'] },
];

const BY_SPELLING: ReadonlyMap<string, Unit> = new Map(UNITS.flatMap((u) => u.spellings.map((s) => [s, u] as const)));

const toKelvin = (u: Unit, v: number): number => (u.one.endsWith('Celsius') ? v + 273.15 : u.one.endsWith('Fahrenheit') ? (v - 32) * (5 / 9) + 273.15 : v);
const fromKelvin = (u: Unit, k: number): number => (u.one.endsWith('Celsius') ? k - 273.15 : u.one.endsWith('Fahrenheit') ? (k - 273.15) * (9 / 5) + 32 : k);

/** Convert `value` from one unit spelling to another, or null when either is unknown,
 *  the dimensions differ, or the result is not a physical value. */
export function convertUnits(value: number, from: string, to: string): { value: number; from: Unit; to: Unit } | null {
  const a = BY_SPELLING.get(from.trim());
  const b = BY_SPELLING.get(to.trim());
  if (!a || !b || a === b || a.dimension !== b.dimension || !Number.isFinite(value)) return null;
  if (a.dimension === 'temperature') {
    const k = toKelvin(a, value);
    return k < 0 ? null : { value: fromKelvin(b, k), from: a, to: b };
  }
  if (value < 0) return null;
  return { value: (value * a.factor) / b.factor, from: a, to: b };
}

const NUM = '(-?\\d+(?:\\.\\d+)?)';
/** A unit of up to three words; the joining words of the phrasings below never count
 *  as part of a unit, so "how many days are in a week" reads `days`, not `days are`. */
const UNIT = '([a-z°/]+(?:\\s(?!(?:to|in|into|are|is|make|a|an)\\b)[a-z]+){0,2})';
/** "convert 5 km to miles" · "5 km in miles" · "what is 72 °f in celsius" */
const FORWARD = new RegExp(`^(?:convert\\s+|what(?:'s| is)\\s+)?${NUM}\\s*${UNIT}\\s+(?:to|in|into)\\s+${UNIT}$`);
/** "how many feet in 3 miles" · "how many grams are in 2 pounds" */
const HOW_MANY = new RegExp(`^how many\\s+${UNIT}\\s+(?:are\\s+)?(?:in|is|make)\\s+(?:a\\s+|an\\s+)?${NUM}?\\s*${UNIT}$`);

const display = (u: Unit, v: number, shown: string): string => `${shown} ${v === 1 ? u.one : u.many}`;

function answerConversion(question: string): DeterministicAnswer | null {
  const q = normalizeQuestion(question);
  let value: number;
  let from: string;
  let to: string;
  const forward = FORWARD.exec(q);
  const howMany = forward ? null : HOW_MANY.exec(q);
  if (forward) {
    value = Number(forward[1]);
    from = forward[2]!;
    to = forward[3]!;
  } else if (howMany) {
    value = howMany[2] === undefined ? 1 : Number(howMany[2]);
    from = howMany[3]!;
    to = howMany[1]!;
  } else {
    return null;
  }
  const converted = convertUnits(value, from, to);
  if (!converted) return null;
  const inShown = formatNumber(value);
  const outShown = formatNumber(converted.value, 6);
  if (inShown === null || outShown === null) return null;
  return {
    handler: 'unit_conversion',
    content: `${display(converted.from, value, inShown)} = ${display(converted.to, Number(outShown), outShown)}`,
  };
}

export const unitConversionHandler: DeterministicHandler = {
  id: 'unit_conversion',
  answer: (question) => answerConversion(question),
};
