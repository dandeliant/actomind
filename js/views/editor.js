// ActoMind – structure editor: fix recognition, assign text to characters, split/merge/reorder, manage characters.
import { h, btn, iconBtn, field, toast, modal, confirmDialog, promptDialog, banner, selectEl, linkBtn } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { setHeader, navigate } from '../ui/shell.js';
import { t, tn } from '../core/i18n.js';
import { getScript, saveScript, addCharacter, setActiveScript, getProgress, saveProgress } from '../core/store.js';
import { parseScript, CHARACTER_COLORS } from '../core/parser.js';
import { uid } from '../core/util.js';

const TYPES = ['line', 'direction', 'scene', 'act'];

export default async function editorView(root, params, query) {
  const script = await getScript(params.id);
  if (!script) { navigate('#/scripts'); return; }
  await setActiveScript(script.id);
  setHeader(t('editor.title'));
  const history = [];
  let selected = null; // item id in edit mode
  let filterChar = '';
  const snapshot = () => JSON.stringify({ items: script.items, characters: script.characters });
  const pushHistory = () => { history.push(snapshot()); if (history.length > 40) history.shift(); undoBtn.disabled = false; };
  const commit = async () => { await saveScript(script, { silent: true }); };

  const charsBox = h('div', { class: 'card' });
  const listBox = h('div');
  const undoBtn = btn(t('editor.undo'), async () => {
    const prev = history.pop();
    if (!prev) return;
    const o = JSON.parse(prev);
    script.items = o.items;
    script.characters = o.characters;
    await commit();
    undoBtn.disabled = !history.length;
    renderAll();
  }, { cls: 'btn-sm', icon: 'refresh', disabled: true });

  root.append(
    query.fresh ? banner('ok', 'check', h('strong', {}, t('editor.freshTitle')), h('div', {}, t('editor.freshText'))) : null,
    h('div', { class: 'row between', style: { marginBottom: '10px' } },
      h('div', {}, h('h1', { style: { margin: 0 } }, script.title), h('div', { class: 'small muted' }, t('editor.subtitle'))),
      linkBtn(t('editor.next'), `#/script/${script.id}/roles`, { cls: 'btn-primary', icon: 'right' })),
    h('div', { class: 'row', style: { marginBottom: '12px' } },
      undoBtn,
      btn(t('editor.showOriginal'), showOriginal, { cls: 'btn-sm', icon: 'file' }),
      btn(t('editor.reparse'), reparse, { cls: 'btn-sm', icon: 'sparkles' }),
      btn(t('editor.addItem'), () => insertAfter(null), { cls: 'btn-sm', icon: 'plus' })),
    charsBox,
    listBox,
  );

  function charOptions(includeNone = false) {
    return [...(includeNone ? [{ value: '', label: '—' }] : []), ...script.characters.map((c) => ({ value: c.id, label: c.name }))];
  }

  function renderChars() {
    const counts = new Map();
    script.items.forEach((i) => { if (i.type === 'line') counts.set(i.charId, (counts.get(i.charId) || 0) + 1); });
    charsBox.replaceChildren(
      h('div', { class: 'card-title' }, h('h3', {}, t('editor.characters')), btn(t('editor.addCharacter'), async () => {
        const name = await promptDialog(t('editor.addCharacter'), { label: t('editor.charName') });
        if (!name?.trim()) return;
        pushHistory();
        addCharacter(script, name);
        await commit();
        renderAll();
      }, { cls: 'btn-sm', icon: 'plus' })),
      script.characters.length ? null : h('p', { class: 'muted' }, t('editor.noCharacters')),
      ...script.characters.map((c) => {
        const nameIn = h('input', { type: 'text', value: c.name, style: { flex: 1, minWidth: '120px' }, 'aria-label': t('editor.charName') });
        nameIn.addEventListener('change', async () => {
          if (!nameIn.value.trim()) { nameIn.value = c.name; return; }
          pushHistory();
          c.name = nameIn.value.trim();
          await commit();
          renderList();
        });
        const color = h('input', { type: 'color', value: toHex(c.color), 'aria-label': t('editor.color') });
        color.addEventListener('change', async () => { c.color = color.value; await commit(); renderList(); });
        return h('div', { class: 'char-row' },
          color, nameIn,
          h('span', { class: 'chip' }, tn('common.linesN', counts.get(c.id) || 0)),
          btn(filterChar === c.id ? t('editor.showAll') : t('editor.filter'), () => { filterChar = filterChar === c.id ? '' : c.id; renderAll(); }, { cls: 'btn-sm btn-ghost', icon: 'eye' }),
          btn(t('editor.merge'), () => mergeChar(c), { cls: 'btn-sm btn-ghost', icon: 'merge', disabled: script.characters.length < 2 }),
          iconBtn('trash', t('common.delete'), () => deleteChar(c, counts.get(c.id) || 0), 'btn-sm btn-ghost btn-danger'));
      }),
    );
  }

  async function mergeChar(c) {
    const others = script.characters.filter((x) => x.id !== c.id);
    let target = others[0].id;
    modal({
      title: t('editor.mergeTitle', { name: c.name }),
      body: h('div', {}, h('p', {}, t('editor.mergeText')), selectEl(others.map((o) => ({ value: o.id, label: o.name })), target, (v) => { target = v; })),
      actions: [
        { label: t('common.cancel') },
        { label: t('editor.merge'), cls: 'btn-primary', onClick: async () => {
          pushHistory();
          script.items.forEach((i) => { if (i.charId === c.id) i.charId = target; });
          script.characters = script.characters.filter((x) => x.id !== c.id);
          script.myRoles = script.myRoles.filter((x) => x !== c.id);
          if (script.voices[c.id]) delete script.voices[c.id];
          await commit();
          renderAll();
          toast(t('editor.merged'));
        } },
      ],
    });
  }

  async function deleteChar(c, count) {
    if (count > 0) { toast(t('editor.charInUse'), { type: 'error' }); return; }
    pushHistory();
    script.characters = script.characters.filter((x) => x.id !== c.id);
    script.myRoles = script.myRoles.filter((x) => x !== c.id);
    await commit();
    renderAll();
  }

  function itemLabel(it) {
    if (it.type === 'line') {
      const c = script.characters.find((x) => x.id === it.charId);
      return h('span', { style: { color: c?.color || 'var(--bad)', fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.8rem' } }, (c?.name || t('editor.noChar')).toUpperCase(), it.parenthetical ? h('span', { class: 'paren', style: { color: 'var(--muted)', fontWeight: 400 } }, ' (' + it.parenthetical + ')') : null);
    }
    return h('span', { class: 'chip' + (it.type === 'direction' ? '' : ' gold') }, t('editor.type.' + it.type));
  }

  function renderList() {
    listBox.replaceChildren();
    const items = script.items;
    if (!items.length) {
      listBox.appendChild(h('div', { class: 'card flat center' }, h('p', { class: 'muted' }, t('editor.emptyList')), btn(t('editor.addItem'), () => insertAfter(null), { cls: 'btn-primary', icon: 'plus' })));
      return;
    }
    items.forEach((it, idx) => {
      if (filterChar && !(it.type === 'line' && it.charId === filterChar)) return;
      listBox.appendChild(it.id === selected ? editForm(it, idx) : compactRow(it, idx));
    });
  }

  function compactRow(it, idx) {
    const el = h('div', {
      class: 'ed-item t-' + it.type, role: 'button', tabindex: '0',
      style: it.type === 'line' ? { borderLeftColor: script.characters.find((c) => c.id === it.charId)?.color || 'var(--bad)' } : null,
      onclick: () => { selected = it.id; renderList(); },
      onkeydown: (e) => { if (e.key === 'Enter') { selected = it.id; renderList(); } },
    },
    h('div', { class: 'ed-head' }, h('span', { class: 'muted small' }, '#' + (idx + 1)), itemLabel(it)),
    h('div', { style: { fontFamily: 'var(--font-script)', whiteSpace: 'pre-line', fontStyle: it.type === 'direction' ? 'italic' : 'normal', color: it.type === 'direction' ? 'var(--muted)' : 'var(--text)' } }, it.text || h('span', { class: 'muted' }, '…')));
    return el;
  }

  function editForm(it, idx) {
    const ta = h('textarea', { 'aria-label': t('editor.text') });
    ta.value = it.text;
    ta.addEventListener('input', () => { it.text = ta.value; scheduleSave(); });
    ta.addEventListener('focus', () => pushHistoryOnce());
    const typeSel = selectEl(TYPES.map((x) => ({ value: x, label: t('editor.type.' + x) })), it.type, async (v) => {
      pushHistory();
      it.type = v;
      if (v === 'line' && !it.charId) it.charId = script.characters[0]?.id || '';
      if (v !== 'line') { delete it.charId; delete it.parenthetical; }
      await commit();
      renderList();
    }, { 'aria-label': t('editor.typeLabel') });
    const charSel = it.type === 'line' ? selectEl(charOptions(true), it.charId || '', async (v) => {
      pushHistory();
      if (v === '__new') return;
      it.charId = v;
      await commit();
      renderList();
    }, { 'aria-label': t('editor.character') }) : null;
    const parenIn = it.type === 'line' ? h('input', { type: 'text', value: it.parenthetical || '', placeholder: t('editor.parenthetical'), 'aria-label': t('editor.parenthetical') }) : null;
    parenIn?.addEventListener('change', async () => { pushHistory(); it.parenthetical = parenIn.value.trim(); await commit(); });

    return h('div', { class: 'ed-item selected t-' + it.type },
      h('div', { class: 'ed-head' }, h('span', { class: 'muted small' }, '#' + (idx + 1)), typeSel, charSel, parenIn,
        iconBtn('check', t('common.done'), async () => { await commit(); selected = null; renderAll(); }, 'btn-sm btn-primary')),
      ta,
      h('div', { class: 'ed-tools' },
        btn(t('editor.split'), () => splitAtCursor(it, ta), { cls: 'btn-sm', icon: 'scissors', title: t('editor.splitHint') }),
        btn(t('editor.assignSel'), () => assignSelection(it, ta), { cls: 'btn-sm', icon: 'user', title: t('editor.assignSelHint') }),
        btn(t('editor.mergeNext'), () => mergeNext(it, idx), { cls: 'btn-sm', icon: 'merge', disabled: idx >= script.items.length - 1 }),
        iconBtn('arrowUp', t('editor.moveUp'), () => move(idx, -1), 'btn-sm'),
        iconBtn('arrowDown', t('editor.moveDown'), () => move(idx, 1), 'btn-sm'),
        btn(t('editor.insertAfter'), () => insertAfter(it), { cls: 'btn-sm', icon: 'plus' }),
        btn(t('common.delete'), () => removeItem(idx), { cls: 'btn-sm btn-ghost btn-danger', icon: 'trash' })),
      h('div', { class: 'hint' }, t('editor.inlineDirHint')));
  }

  let histOnce = false;
  function pushHistoryOnce() { if (!histOnce) { pushHistory(); histOnce = true; setTimeout(() => { histOnce = false; }, 4000); } }
  let saveTimer = null;
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(commit, 500); }

  async function splitAtCursor(it, ta) {
    const pos = ta.selectionStart;
    const a = it.text.slice(0, pos).trim();
    const b = it.text.slice(pos).trim();
    if (!a || !b) { toast(t('editor.splitNeedCursor'), { type: 'error' }); return; }
    pushHistory();
    it.text = a;
    const n = { ...it, id: uid('i_'), text: b };
    if (n.type === 'line') n.parenthetical = '';
    script.items.splice(script.items.indexOf(it) + 1, 0, n);
    await commit();
    renderList();
  }

  function assignSelection(it, ta) {
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    if (e <= s) { toast(t('editor.selectFirst'), { type: 'error' }); return; }
    let type = 'line';
    let charId = script.characters.find((c) => c.id !== it.charId)?.id || script.characters[0]?.id || '';
    const opts = [...script.characters.map((c) => ({ value: 'c:' + c.id, label: c.name })), { value: 't:direction', label: t('editor.type.direction') }, { value: 't:scene', label: t('editor.type.scene') }, { value: 't:act', label: t('editor.type.act') }, { value: 'new', label: t('editor.newCharacter') }];
    let choice = charId ? 'c:' + charId : 't:direction';
    modal({
      title: t('editor.assignTitle'),
      body: h('div', {}, h('p', { class: 'small muted' }, '„' + ta.value.slice(s, e).slice(0, 200) + '”'), selectEl(opts, choice, (v) => { choice = v; })),
      actions: [
        { label: t('common.cancel') },
        { label: t('common.ok'), cls: 'btn-primary', onClick: async () => {
          if (choice === 'new') {
            const name = await promptDialog(t('editor.addCharacter'), { label: t('editor.charName') });
            if (!name?.trim()) return false;
            choice = 'c:' + addCharacter(script, name).id;
          }
          if (choice.startsWith('c:')) { type = 'line'; charId = choice.slice(2); } else { type = choice.slice(2); charId = null; }
          pushHistory();
          const before = it.text.slice(0, s).trim();
          const mid = it.text.slice(s, e).trim();
          const after = it.text.slice(e).trim();
          const pos = script.items.indexOf(it);
          const parts = [];
          if (before) parts.push({ ...it, text: before });
          parts.push(type === 'line' ? { id: uid('i_'), type, charId, parenthetical: '', text: mid } : { id: uid('i_'), type, text: mid });
          if (after) parts.push({ ...it, id: uid('i_'), text: after, ...(it.type === 'line' ? { parenthetical: '' } : {}) });
          if (!before) parts[0].id = parts[0].id || uid('i_');
          script.items.splice(pos, 1, ...parts);
          selected = null;
          await commit();
          renderAll();
          toast(t('editor.assigned'));
          return true;
        } },
      ],
    });
  }

  async function mergeNext(it, idx) {
    const nxt = script.items[idx + 1];
    if (!nxt) return;
    pushHistory();
    it.text = [it.text, nxt.text].filter(Boolean).join('\n');
    script.items.splice(idx + 1, 1);
    await commit();
    renderList();
  }

  async function move(idx, d) {
    const j = idx + d;
    if (j < 0 || j >= script.items.length) return;
    pushHistory();
    const arr = script.items;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    await commit();
    renderList();
  }

  async function insertAfter(it) {
    pushHistory();
    const n = { id: uid('i_'), type: script.characters.length ? 'line' : 'direction', text: '' };
    if (n.type === 'line') { n.charId = script.characters[0].id; n.parenthetical = ''; }
    const pos = it ? script.items.indexOf(it) + 1 : script.items.length;
    script.items.splice(pos, 0, n);
    selected = n.id;
    await commit();
    renderList();
    setTimeout(() => listBox.querySelector('.ed-item.selected textarea')?.focus(), 50);
  }

  async function removeItem(idx) {
    pushHistory();
    script.items.splice(idx, 1);
    selected = null;
    await commit();
    renderList();
    toast(t('editor.removed'), { action: { label: t('editor.undo'), onClick: () => undoBtn.click() } });
  }

  function showOriginal() {
    modal({ title: t('editor.original'), wide: true, body: h('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'var(--font-script)', maxHeight: '60vh', overflow: 'auto' } }, script.rawText || t('editor.noOriginal')), actions: [{ label: t('common.close') }] });
  }

  async function reparse() {
    if (!script.rawText) { toast(t('editor.noOriginal'), { type: 'error' }); return; }
    if (!(await confirmDialog(t('editor.reparseConfirm'), { danger: true }))) return;
    pushHistory();
    const p = parseScript(script.rawText);
    // keep character settings when names match
    const oldByName = new Map(script.characters.map((c) => [c.name.toUpperCase(), c]));
    const idMap = new Map();
    p.characters.forEach((c) => { const o = oldByName.get(c.name.toUpperCase()); if (o) { idMap.set(c.id, o.id); c.id = o.id; c.color = o.color; } });
    p.items.forEach((i) => { if (i.charId && idMap.has(i.charId)) i.charId = idMap.get(i.charId); });
    script.characters = p.characters;
    script.items = p.items;
    script.myRoles = script.myRoles.filter((r) => p.characters.some((c) => c.id === r));
    const prog = await getProgress(script.id);
    prog.records = {};
    saveProgress(prog);
    await commit();
    renderAll();
    toast(t('editor.reparsed'));
  }

  function renderAll() { renderChars(); renderList(); }
  renderAll();
  return () => { clearTimeout(saveTimer); commit(); };
}

function toHex(c) {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  return CHARACTER_COLORS[0];
}
