// ActoMind – learning mode registry (routes, icons) used by hubs and plans.
export const MODES = {
  understand: { href: '#/learn/read', icon: 'book' },
  listen: { href: '#/learn/listen?mode=repeat', icon: 'headphones' },
  vanishing: { href: '#/learn/train/vanish', icon: 'vanish' },
  firstletters: { href: '#/learn/train/letters', icon: 'letters' },
  chunks: { href: '#/learn/chunks', icon: 'split' },
  review: { href: '#/learn/train/review', icon: 'brain' },
  cues: { href: '#/learn/train/cues', icon: 'shuffle' },
  partner: { href: '#/rehearse/partner', icon: 'masks' },
  dress: { href: '#/rehearse/dress', icon: 'curtain' },
  hardest: { href: '#/learn/train/hardest', icon: 'flame' },
  cards: { href: '#/learn/train/cards', icon: 'cards' },
  exercises: { href: '#/learn/exercises', icon: 'puzzle' },
};
export const modeHref = (m) => MODES[m]?.href || '#/learn';
export const modeIcon = (m) => MODES[m]?.icon || 'brain';
