// ActoMind – automatic voice casting: different voice per character, matched by (guessed) gender.
// Heuristics only – the user can always change any voice afterwards.

const PL_FEMALE_WORDS = ['PANI', 'MATKA', 'MAMA', 'CÓRKA', 'SIOSTRA', 'BABCIA', 'CIOTKA', 'ŻONA', 'KRÓLOWA', 'KSIĘŻNICZKA', 'DZIEWCZYNA', 'KOBIETA', 'DAMA', 'PANNA', 'WDOWA', 'NARRATORKA', 'LEKTORKA'];
const PL_MALE_WORDS = ['PAN', 'OJCIEC', 'TATA', 'SYN', 'BRAT', 'DZIADEK', 'WUJ', 'WUJEK', 'KRÓL', 'KSIĄŻĘ', 'CHŁOPAK', 'CHŁOPIEC', 'MĘŻCZYZNA', 'MĄŻ', 'NARRATOR', 'LEKTOR'];
// masculine nouns / names ending with -a
const PL_MALE_A = new Set(['TATA', 'POETA', 'KOLEGA', 'SĘDZIA', 'MĘŻCZYZNA', 'STAROSTA', 'WOJEWODA', 'KUBA', 'BARNABA', 'KOSMA', 'ZAWISZA', 'BONAWENTURA', 'SŁUGA', 'HRABIA', 'BACA', 'WÓJT', 'PREZYDENTA', 'KAPELMISTRZA', 'ATAMAN', 'GAZDA', 'DOZORCA', 'KIEROWCA', 'OBROŃCA', 'ZDRAJCA', 'WIDZA', 'MORDERCA', 'SPRZEDAWCA', 'MAJSTRA', 'WŁAŚCICIELA']);
const EN_FEMALE = ['MOTHER', 'MUM', 'MOM', 'MRS', 'MS', 'MISS', 'LADY', 'QUEEN', 'PRINCESS', 'SISTER', 'DAUGHTER', 'WIFE', 'AUNT', 'GRANDMOTHER', 'GRANDMA', 'GIRL', 'WOMAN', 'ACTRESS', 'WAITRESS', 'DUCHESS', 'MAID', 'NUN', 'WIDOW', 'BRIDE', 'HEADMISTRESS'];
const EN_MALE = ['FATHER', 'DAD', 'MR', 'SIR', 'LORD', 'KING', 'PRINCE', 'BROTHER', 'SON', 'HUSBAND', 'UNCLE', 'GRANDFATHER', 'GRANDPA', 'BOY', 'MAN', 'HEADMASTER', 'DUKE', 'MONK', 'PRIEST', 'GROOM', 'BUTLER', 'WAITER', 'ACTOR'];
const FEMALE_NAMES = ['MARY', 'ANNE', 'ALICE', 'JANE', 'KATE', 'LUCY', 'SARAH', 'EMMA', 'HELEN', 'ELIZABETH', 'SOPHIE', 'OLIVIA', 'EMILY', 'GRACE', 'CHARLOTTE', 'AMY', 'RACHEL', 'HAZEL', 'SUSAN', 'ZIRA', 'ARIA', 'JENNY', 'SONIA', 'LIBBY', 'MAISIE', 'ALBA', 'CORI', 'KATHLEEN', 'KRISTIN', 'LESSAC', 'SAMANTHA', 'KAREN', 'MOIRA', 'TESSA', 'VICTORIA', 'FIONA', 'ZOSIA', 'EWA', 'NATALIA'];
const MALE_NAMES = ['DAVID', 'MARK', 'GEORGE', 'GUY', 'RYAN', 'CHRISTOPHER', 'ERIC', 'ADAM', 'MAREK', 'KRZYSZTOF', 'PAUL', 'DANIEL', 'THOMAS', 'JAMES', 'BRIAN', 'ANDREW', 'STEFFAN', 'ALAN', 'JOE', 'JOHN', 'MIKE', 'SAM', 'NORMAN', 'BRYCE', 'DANNY', 'ALEX', 'FRED', 'JACEK', 'JAN', 'PIOTR', 'TOMASZ', 'OLIVER', 'ARTHUR', 'RISHI', 'AARON'];

const words = (s) => String(s || '').toUpperCase().normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean);

/** Guess the gender of a character from its name. */
export function guessGender(name, lang = 'pl') {
  const w = words(name);
  if (!w.length) return null;
  if (w.some((x) => EN_FEMALE.includes(x) || FEMALE_NAMES.includes(x))) return 'FEMALE';
  if (w.some((x) => EN_MALE.includes(x) || MALE_NAMES.includes(x))) return 'MALE';
  if (w.some((x) => PL_FEMALE_WORDS.includes(x))) return 'FEMALE';
  if (w.some((x) => PL_MALE_WORDS.includes(x))) return 'MALE';
  if (lang === 'pl') {
    // the head noun is usually the first word ("MATKA KACPRA", "DYREKTOR SZKOŁY")
    const head = w[0];
    if (PL_MALE_A.has(head)) return 'MALE';
    if (head.endsWith('A')) return 'FEMALE';
    if (/[BCDFGHJKLŁMNPRSTWZŻŹĆŃŚ]$/.test(head) || head.endsWith('O') || head.endsWith('Y') || head.endsWith('I')) return 'MALE';
    return null;
  }
  const head = w[w.length - 1];
  if (/(A|IE|ETTE|INE)$/.test(head)) return 'FEMALE';
  return null;
}

/** Guess the gender of a browser voice from its display name ("Microsoft Paulina - Polish"). */
export function guessVoiceGender(voiceName) {
  const raw = String(voiceName || '').replace(/^(Microsoft|Google|Apple)\s+/i, '');
  const first = words(raw)[0] || '';
  if (/female|kobiet/i.test(voiceName)) return 'FEMALE';
  if (/\bmale\b|mężczyzn/i.test(voiceName)) return 'MALE';
  if (FEMALE_NAMES.includes(first)) return 'FEMALE';
  if (MALE_NAMES.includes(first)) return 'MALE';
  if (/^(AGNIESZKA|ZOFIA|PAULINA|MAJA|EWA|ALICJA|KASIA|ANNA|AGATA|IZABELA|MARTA|JOANNA)$/.test(first)) return 'FEMALE';
  if (first.length > 2 && first.endsWith('A') && !PL_MALE_A.has(first)) return 'FEMALE';
  return null;
}

/**
 * Assign voices to characters.
 * @param {{id:string, name:string, lines:number}[]} chars  ordered by importance (most lines first)
 * @param {{id:string, gender:'FEMALE'|'MALE'|null, speakers?:number}[]} pool available voices
 * @param {string} lang
 * @returns {Record<string, {voice:string, variant:number, gender:string|null}>}
 */
export function autoCast(chars, pool, lang = 'pl') {
  const out = {};
  if (!pool.length) return out;
  const used = new Map(pool.map((v) => [v.id, 0]));
  const sorted = [...chars].sort((a, b) => (b.lines || 0) - (a.lines || 0));
  for (const c of sorted) {
    const g = guessGender(c.name, lang);
    const match = pool.filter((v) => !g || !v.gender || v.gender === g);
    const cands = (match.length ? match : pool).slice().sort((a, b) => {
      const ua = used.get(a.id);
      const ub = used.get(b.id);
      if (ua !== ub) return ua - ub;
      // prefer voices whose gender is known to match
      return (b.gender === g ? 1 : 0) - (a.gender === g ? 1 : 0);
    });
    const pick = cands[0];
    const variant = used.get(pick.id);
    used.set(pick.id, variant + 1);
    out[c.id] = { voice: pick.id, variant, gender: g };
  }
  return out;
}

/** Variation applied when a voice is reused (so characters still sound different). */
export const VARIANTS = {
  webPitch: [1, 0.82, 1.18, 0.9, 1.1, 0.75, 1.25],
  webRate: [1, 0.95, 1.05, 0.92, 1.08, 1, 1],
  cloudPitch: [0, -3, 3, -1.5, 1.5, -5, 5],
  piperRate: [1, 0.93, 1.07, 0.88, 1.12, 0.96, 1.04],
};
export const variantOf = (list, i) => list[i % list.length];
