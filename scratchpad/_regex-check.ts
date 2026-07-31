import { labelSummaryCurrency } from '../src/ai/quoteCurrency.js';
const cases = [
  'Your quote is $8,578.39 total.',
  'Total $50.00 due now.',
  'Liftgate surplus $12.00 applies.',
  'Already CA$8,578.39 here.',
  'Mixed CA$1.00 and $2.00.',
  'USD $5.00 explicit.',
  'No money at all.',
  '',
];
let allSafe = true;
for (const c of cases) {
  const out = labelSummaryCurrency(c, 'CAD');
  const a = (c.match(/\d/g) || []).join('');
  const b = (out.match(/\d/g) || []).join('');
  const safe = a === b;
  if (!safe) allSafe = false;
  console.log((safe ? 'OK  ' : 'FAIL') + ' | ' + JSON.stringify(c) + ' -> ' + JSON.stringify(out));
}
const twice = labelSummaryCurrency(labelSummaryCurrency('Total $50.00', 'CAD'), 'CAD');
console.log('idempotent (no CACA$):', !twice.includes('CACA$'), '->', JSON.stringify(twice));
console.log('USD passthrough unchanged:', labelSummaryCurrency('Total $50.00', 'USD') === 'Total $50.00');
console.log('ALL DIGITS PRESERVED:', allSafe);
