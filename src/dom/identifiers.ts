import { match, P } from 'ts-pattern';

export type CharClass = 'Upper' | 'Lower' | 'Digit' | 'Symbol' | 'Other';

export const GIBBERISH_THRESHOLD = 0.3;

type TransitionKey = `${CharClass}:${CharClass}`;
const PRICE_TABLE: Partial<Record<TransitionKey, number>> = {
  'Upper:Lower': 0.2,
  'Lower:Upper': 0.5,
  'Symbol:Upper': 0.4,
  'Symbol:Lower': 0.3,
  'Symbol:Digit': 0.9,
  'Upper:Digit': 1.4,
  'Lower:Digit': 1.3,
  'Digit:Upper': 1.4,
  'Digit:Lower': 1.5,
  'Digit:Symbol': 1.2,
  'Upper:Symbol': 0.2,
  'Lower:Symbol': 0.2,

  'Digit:Digit': 1.2,
  'Symbol:Symbol': 0.3,
  'Upper:Upper': 0.1,
  'Lower:Lower': 0.1,
  'Other:Other': 0.0,
};

function classifyChar(c: string): CharClass {
  return match(c)
    .with(P.when((ch) => /[A-Z]/.test(ch)), () => 'Upper')
    .with(P.when((ch) => /[a-z]/.test(ch)), () => 'Lower')
    .with(P.when((ch) => /[0-9]/.test(ch)), () => 'Digit')
    .with(P.when((ch) => /[-_]/.test(ch)), () => 'Symbol')
    .otherwise((): CharClass => 'Other') as CharClass;
}

function transitionPrice({ from, to }: { from: CharClass; to: CharClass }): number {
  const key: TransitionKey = `${from}:${to}` as TransitionKey;
  return PRICE_TABLE[key] ?? 1.0;
}

export function isGibberishIdentifier(value: string): boolean {
  if (value.length < 4) return false;
  const score = getGibberishScore(value);
  return score >= GIBBERISH_THRESHOLD;
}

export function measureGibberishScore(value: string): { absoluteScore: number; normalizedScore: number } {
  if (value.length < 2) return { absoluteScore: 0, normalizedScore: 0 };
  let absoluteScore = 0;
  let previousClass: CharClass | null = null;
  for (const ch of value) {
    const currentClass = classifyChar(ch);
    if (previousClass !== null) {
      absoluteScore += transitionPrice({ from: previousClass, to: currentClass });
    }
    previousClass = currentClass;
  }
  const steps = Math.max(1, value.length - 1);
  return { absoluteScore, normalizedScore: absoluteScore / steps };
}

export function getGibberishScore(value: string): number {
  return measureGibberishScore(value).normalizedScore;
}


