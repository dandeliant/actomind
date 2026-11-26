// ActoMind – acting mentor: notes per line (goal, intention, emotion, subtext…), guiding questions, practising with intentions.
// No AI model is used: the app offers questions, templates and the actor's own notes and recordings.
import { h, btn, iconBtn, field, toast, selectEl, banner } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader } from '../ui/shell.js';
import { t, fmtDateTime } from '../core/i18n.js';
import { saveScriptSoon, myLines, bumpTotal, SessionTracker } from '../core/store.js';
import { requireScript, whoLabel, lineTextEl, charName } from '../ui/common.js';
import { cueFor } from '../core/parser.js';
import { spokenText } from '../core/tokenize.js';
import { recordWidget, blobAudio } from '../ui/recwidget.js';
import { listRecordings } from '../core/recorder.js';
import { speakItem } from '../audio/voice-engine.js';

const FIELDS = ['goal', 'intention', 'emotion', 'subtext', 'keyword', 'gesture', 'movement', 'pause', 'intonation', 'relation'];
const QUESTIONS = ['want', 'why', 'before', 'reaction', 'change'];
const INTENTIONS = ['ironic', 'calm', 'firm', 'disbelief', 'irritated', 'tender', 'playful', 'desperate'];

export default async function mentorView(root, params, query) {
  setHeader(t('mentor.title'));
  const script = await requireScript(root);
  if (!script) return;
  const tracker = new SessionTracker(script.id, 'mentor');
  const lines = myLines(script);
  let idx = Math.max(0, lines.findIndex((l) => l.id === query.line));
  let intention = INTENTIONS[0];
  let customIntention = '';
  const body = h('div');
  let recW = null;

  root.append(
    h('div', { class: 'card hero' }, h('h1', {}, t('mentor.title')), h('p', { class: 'text-2' }, t('mentor.intro')), h('p', { class: 'small muted' }, t('mentor.honest'))),
    body,
  );

  async function render() {
    recW?.destroy?.();
    body.replaceChildren();
    const line = lines[idx];
    const note = script.notes[line.id] || (script.notes[line.id] = {});
    note.mentor = note.mentor || {};
    note.answers = note.answers || {};
    const cue = cueFor(script.items, script.items.indexOf(line));
    const save = () => { script.notes[line.id] = note; saveScriptSoon(script); tracker.activity(); };
    let counted = Object.values(note.mentor).some(Boolean);

    const nav = h('div', { class: 'row between card flat' },
      iconBtn('left', t('mentor.prev'), () => { idx = (idx - 1 + lines.length) % lines.length; render(); }),
      selectEl(lines.map((l, i) => ({ value: String(i), label: `${i + 1}. ${spokenText(l.text).slice(0, 50)}` })), String(idx), (v) => { idx = Number(v); render(); }, { style: { flex: 1 }, 'aria-label': t('mentor.chooseLine') }),
      iconBtn('right', t('mentor.next'), () => { idx = (idx + 1) % lines.length; render(); }));

    const fields = h('div', { class: 'grid grid-2 stack-sm' }, FIELDS.map((f) => {
      const ta = h('textarea', { style: { minHeight: '64px' }, placeholder: t('mentor.ph.' + f) });
      ta.value = note.mentor[f] || '';
      ta.addEventListener('input', () => {
        note.mentor[f] = ta.value;
        save();
        if (!counted && ta.value.trim()) { counted = true; bumpTotal('mentorNotes'); }
      });
      return field(t('mentor.fields.' + f), ta);
    }));

    const questions = h('div', {}, QUESTIONS.map((q) => {
      const ta = h('textarea', { style: { minHeight: '56px' }, placeholder: t('mentor.answerPh') });
      ta.value = note.answers[q] || '';
      ta.addEventListener('input', () => { note.answers[q] = ta.value; save(); });
      return field(t('mentor.q.' + q), ta);
    }));

    const templates = h('div', { class: 'row' }, ['objective', 'beats', 'subtext'].map((k) => btn(t('mentor.tpl.' + k + '.name'), () => {
      const target = k === 'subtext' ? 'subtext' : 'goal';
      note.mentor[target] = (note.mentor[target] ? note.mentor[target] + '\n' : '') + t('mentor.tpl.' + k + '.text');
      save();
      render();
    }, { cls: 'btn-sm', icon: 'note' })));

    // practice with intentions
    const recList = h('div', { class: 'list' });
    const loadRecs = async () => {
      const recs = (await listRecordings(script.id)).filter((r) => r.lineId === line.id);
      recList.replaceChildren(...(recs.length ? recs.map((r) => h('div', { class: 'list-item', style: { flexDirection: 'column', alignItems: 'stretch' } },
        h('div', { class: 'row between' }, h('span', { class: 'chip gold' }, r.intention || t('mentor.noIntention')), h('span', { class: 'small muted' }, fmtDateTime(r.createdAt))),
        blobAudio(r.blob))) : [h('p', { class: 'small muted' }, t('mentor.noRecs'))]));
    };
    const intentionLabel = () => (intention === 'custom' ? customIntention : t('mentor.int.' + intention));
    const intentionPanel = h('div', {});
    const renderIntent = () => {
      intentionPanel.replaceChildren(
        h('div', { class: 'row' }, [...INTENTIONS, 'custom'].map((i) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(i === intention), onclick: () => { intention = i; renderIntent(); } }, i === 'custom' ? t('mentor.custom') : t('mentor.int.' + i)))),
        intention === 'custom' ? h('input', { type: 'text', value: customIntention, placeholder: t('mentor.customPh'), oninput: (e) => { customIntention = e.target.value; }, style: { marginTop: '8px' } }) : null,
        h('div', { class: 'banner info', style: { marginTop: '10px' } }, icon('masks'), h('div', {}, t('mentor.sayIt', { how: intentionLabel() || '…' }))));
    };
    renderIntent();
    recW = recordWidget({ scriptId: script.id, lineId: line.id, intention: intentionLabel, onSaved: loadRecs, label: t('mentor.recordWith') });

    body.append(
      nav,
      h('div', { class: 'card' },
        cue.kind === 'line' ? h('div', { class: 'cue-card' }, h('div', { class: 'row between' }, h('div', { class: 'who' }, charName(script, cue.item.charId)), iconBtn('volume', t('trainer.playCue'), () => speakItem(script, cue.item.charId, spokenText(cue.item.text), cue.item.id).catch(() => {}), 'btn-sm btn-ghost')), h('div', { class: 'text' }, cue.item.text)) : null,
        h('div', { class: 'line mine' }, whoLabel(script, line), lineTextEl(line.text))),
      h('div', { class: 'section-title' }, t('mentor.questions')),
      h('div', { class: 'card' }, questions),
      h('div', { class: 'section-title' }, t('mentor.analysis')),
      h('div', { class: 'card' }, templates, h('div', { style: { height: '10px' } }), fields),
      h('div', { class: 'section-title' }, t('mentor.intentions')),
      h('div', { class: 'card' }, intentionPanel, h('div', { style: { height: '10px' } }), recW, h('div', { class: 'section-title' }, t('mentor.myTakes')), recList),
    );
    loadRecs();
  }
  if (!lines.length) { body.appendChild(banner('info', 'info', t('mentor.noLines'))); return; }
  render();
  return () => { recW?.destroy?.(); tracker.stop(); };
}
