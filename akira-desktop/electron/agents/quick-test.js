// Quick syntax check
try {
  require('./base-agent');
  console.log('base-agent OK');
} catch(e) { console.log('base-agent FAIL:', e.message); }

try {
  require('./index');
  console.log('index OK');
} catch(e) { console.log('index FAIL:', e.message); }

try {
  require('./specialists/file-agent');
  console.log('file-agent OK');
} catch(e) { console.log('file-agent FAIL:', e.message); }

try {
  require('./specialists/system-agent');
  console.log('system-agent OK');
} catch(e) { console.log('system-agent FAIL:', e.message); }

try {
  require('./specialists/web-agent');
  console.log('web-agent OK');
} catch(e) { console.log('web-agent FAIL:', e.message); }

try {
  require('./specialists/desktop-agent');
  console.log('desktop-agent OK');
} catch(e) { console.log('desktop-agent FAIL:', e.message); }

try {
  require('./orchestrator');
  console.log('orchestrator OK');
} catch(e) { console.log('orchestrator FAIL:', e.message); }

console.log('Done');
