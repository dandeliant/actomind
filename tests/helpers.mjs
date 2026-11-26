import fs from 'node:fs';
import path from 'node:path';

export const ACHIEVEMENTS_IDS = ['first_script', 'first_review', 'reviews_100', 'reviews_500', 'streak_3', 'streak_7', 'streak_30', 'first_partner', 'first_dress', 'no_hint_10', 'no_hint_30', 'clean_scene', 'role_mastered', 'marathon', 'audio_export', 'mentor_10'];

export function collectFiles(dir, ext) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out.push(...collectFiles(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
