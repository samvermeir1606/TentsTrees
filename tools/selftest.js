// Usage: node tools/selftest.js [puzzlesPerLevel]
const TT = require('../engine.js');
const n = parseInt(process.argv[2] || '20', 10);
const ok = TT.selfTest(n, (m) => console.log(m));
process.exit(ok ? 0 : 1);
