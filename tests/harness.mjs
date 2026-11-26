// Tiny test harness (no dependencies)
const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function eq(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg}\n   expected: ${sb}\n   actual:   ${sa}`);
}
export function ok(v, msg = 'assertion failed') { if (!v) throw new Error(msg); }
export function near(a, b, tol = 1e-6, msg = '') { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ${b} ± ${tol}, got ${a}`); }
export async function run(filter) {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    try {
      await t.fn();
      pass++;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      fail++;
      console.log('  ✗ ' + t.name + '\n    ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n    '));
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
