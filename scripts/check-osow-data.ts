import { REQUESTED_OSOW_JURISDICTIONS } from '../src/calc/osow/jurisdictions/index.js';
import {
  formatCoverageReport,
  verifyJurisdictions,
} from '../src/calc/osow/verifyJurisdictions.js';

console.log('OS/OW jurisdiction data coverage');
console.log(formatCoverageReport(REQUESTED_OSOW_JURISDICTIONS));

const issues = verifyJurisdictions(REQUESTED_OSOW_JURISDICTIONS);
if (issues.length > 0) {
  console.error(`\nOS/OW evidence check failed with ${issues.length} issue(s):`);
  for (const issue of issues) {
    console.error(`- ${issue.jurisdiction} ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log('\nOS/OW evidence check passed.');
}
