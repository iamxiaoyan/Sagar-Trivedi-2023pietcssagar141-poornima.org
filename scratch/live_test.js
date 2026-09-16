/**
 * Live endpoint test script — hits every API endpoint and reports results.
 * Run with: node scratch/live_test.js
 */

const BASE = 'http://localhost:3000';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== LIVE ENDPOINT TESTS ===\n');

  // 1. Health check
  console.log('1. Health check (GET /)');
  const health = await req('GET', '/');
  check('Status 200', health.status === 200);
  check('Has message', !!health.data.message);

  // 2. Empty ticket list
  console.log('\n2. Empty ticket list (GET /tickets)');
  const empty = await req('GET', '/tickets');
  check('Status 200', empty.status === 200);
  check('Total is 0', empty.data.total === 0);
  check('Tickets is empty array', Array.isArray(empty.data.tickets) && empty.data.tickets.length === 0);
  check('Has pagination metadata', empty.data.page === 1 && empty.data.limit === 10 && empty.data.totalPages === 1);

  // 3. Create urgent ticket
  console.log('\n3. Create urgent ticket (POST /tickets)');
  const t1 = await req('POST', '/tickets', { customerName: 'Rahul', title: 'Login issue', priority: 'urgent' });
  check('Status 201', t1.status === 201);
  check('Has id', !!t1.data.id);
  check('customerName = Rahul', t1.data.customerName === 'Rahul');
  check('priority = urgent', t1.data.priority === 'urgent');
  check('assignedTo is null', t1.data.assignedTo === null);
  check('Has createdAt', !!t1.data.createdAt);
  check('Has responseDueAt', !!t1.data.responseDueAt);
  const t1Diff = new Date(t1.data.responseDueAt) - new Date(t1.data.createdAt);
  check('Deadline = createdAt + 2 hours', t1Diff === 2 * 60 * 60 * 1000);

  // 4. Create normal ticket
  console.log('\n4. Create normal ticket (POST /tickets)');
  const t2 = await req('POST', '/tickets', { customerName: 'Amit', title: 'Slow page', priority: 'normal' });
  check('Status 201', t2.status === 201);
  check('priority = normal', t2.data.priority === 'normal');
  const t2Diff = new Date(t2.data.responseDueAt) - new Date(t2.data.createdAt);
  check('Deadline = createdAt + 24 hours', t2Diff === 24 * 60 * 60 * 1000);

  // 5. Create ticket with assignedTo
  console.log('\n5. Create ticket with assignedTo (POST /tickets)');
  const t3 = await req('POST', '/tickets', { customerName: 'Rahul', title: 'Billing', priority: 'normal', assignedTo: 'Deepak' });
  check('Status 201', t3.status === 201);
  check('assignedTo = Deepak', t3.data.assignedTo === 'Deepak');

  // 6. Validation - missing customerName
  console.log('\n6. Validation tests (POST /tickets)');
  const v1 = await req('POST', '/tickets', { title: 'X', priority: 'urgent' });
  check('Missing customerName → 400', v1.status === 400);

  const v2 = await req('POST', '/tickets', { customerName: '  ', title: 'X', priority: 'urgent' });
  check('Blank customerName → 400', v2.status === 400);

  const v3 = await req('POST', '/tickets', { customerName: 'A', priority: 'urgent' });
  check('Missing title → 400', v3.status === 400);

  const v4 = await req('POST', '/tickets', { customerName: 'A', title: '', priority: 'urgent' });
  check('Blank title → 400', v4.status === 400);

  const v5 = await req('POST', '/tickets', { customerName: 'A', title: 'B', priority: 'high' });
  check('Invalid priority → 400', v5.status === 400);

  const v6 = await req('POST', '/tickets', { customerName: 'A', title: 'B' });
  check('Missing priority → 400', v6.status === 400);

  const v7 = await req('POST', '/tickets', { customerName: 'A', title: 'B', priority: 'urgent', assignedTo: '  ' });
  check('Blank assignedTo → 400', v7.status === 400);

  // 7. Get ticket queue
  console.log('\n7. Get ticket queue (GET /tickets)');
  const queue = await req('GET', '/tickets');
  check('Status 200', queue.status === 200);
  check('Total is 3', queue.data.total === 3);
  check('First ticket is urgent', queue.data.tickets[0].priority === 'urgent');

  // 8. Get single ticket
  console.log('\n8. Get single ticket (GET /tickets/:id)');
  const single = await req('GET', `/tickets/${t1.data.id}`);
  check('Status 200', single.status === 200);
  check('Correct ID returned', single.data.id === t1.data.id);

  const notFound = await req('GET', '/tickets/fake-id-12345');
  check('Non-existent ID → 404', notFound.status === 404);

  // 9. Customer filter
  console.log('\n9. Customer filter (GET /tickets?customerName=Rahul)');
  const custFilter = await req('GET', '/tickets?customerName=Rahul');
  check('Returns 2 Rahul tickets', custFilter.data.total === 2);
  check('All are Rahul', custFilter.data.tickets.every(t => t.customerName === 'Rahul'));

  const custCase = await req('GET', '/tickets?customerName=rahul');
  check('Case-insensitive returns 2', custCase.data.total === 2);

  const custNone = await req('GET', '/tickets?customerName=Nobody');
  check('Non-existent customer → 0', custNone.data.total === 0);

  // 10. Assign ticket
  console.log('\n10. Assign ticket (PATCH /tickets/:id/assign)');
  const assign1 = await req('PATCH', `/tickets/${t1.data.id}/assign`, { assignedTo: 'Priya' });
  check('Status 200', assign1.status === 200);
  check('assignedTo = Priya', assign1.data.assignedTo === 'Priya');

  const reassign = await req('PATCH', `/tickets/${t1.data.id}/assign`, { assignedTo: 'Meera' });
  check('Reassign to Meera → 200', reassign.status === 200);
  check('assignedTo = Meera', reassign.data.assignedTo === 'Meera');

  const unassign = await req('PATCH', `/tickets/${t1.data.id}/assign`, { assignedTo: null });
  check('Unassign (null) → 200', unassign.status === 200);
  check('assignedTo is null', unassign.data.assignedTo === null);

  const assignNotFound = await req('PATCH', '/tickets/fake-id/assign', { assignedTo: 'X' });
  check('Assign non-existent → 404', assignNotFound.status === 404);

  const assignMissing = await req('PATCH', `/tickets/${t1.data.id}/assign`, {});
  check('Missing assignedTo → 400', assignMissing.status === 400);

  const assignBlank = await req('PATCH', `/tickets/${t1.data.id}/assign`, { assignedTo: '  ' });
  check('Blank assignedTo → 400', assignBlank.status === 400);

  // 11. Assignee filter
  console.log('\n11. Assignee filter (GET /tickets?assignedTo=...)');
  await req('PATCH', `/tickets/${t1.data.id}/assign`, { assignedTo: 'Priya' });
  const assigneeFilter = await req('GET', '/tickets?assignedTo=Priya');
  check('Returns Priya tickets', assigneeFilter.data.total === 1);

  const assigneeCase = await req('GET', '/tickets?assignedTo=priya');
  check('Case-insensitive works', assigneeCase.data.total === 1);

  const assigneeDeepak = await req('GET', '/tickets?assignedTo=Deepak');
  check('Different assignee works', assigneeDeepak.data.total === 1);

  const assigneeNone = await req('GET', '/tickets?assignedTo=Nobody');
  check('Non-existent assignee → 0', assigneeNone.data.total === 0);

  // 12. Overdue tickets
  console.log('\n12. Overdue tickets (GET /tickets/overdue)');
  const overdue1 = await req('GET', '/tickets/overdue');
  check('Status 200', overdue1.status === 200);
  check('No overdue yet (just created)', overdue1.data.total === 0);

  const overdue2 = await req('GET', '/tickets?overdue=true');
  check('Filter also returns 0', overdue2.data.total === 0);

  // 13. Pagination
  console.log('\n13. Pagination (GET /tickets?page=...&limit=...)');
  const pag1 = await req('GET', '/tickets?page=1&limit=2');
  check('Page 1, limit 2 → 2 tickets', pag1.data.tickets.length === 2);
  check('Total is 3', pag1.data.total === 3);
  check('totalPages is 2', pag1.data.totalPages === 2);

  const pag2 = await req('GET', '/tickets?page=2&limit=2');
  check('Page 2 → 1 ticket', pag2.data.tickets.length === 1);

  const pagBeyond = await req('GET', '/tickets?page=100&limit=10');
  check('Beyond last page → empty', pagBeyond.data.tickets.length === 0);
  check('Still has total', pagBeyond.data.total === 3);

  // 14. Pagination validation
  console.log('\n14. Pagination validation');
  const pagV1 = await req('GET', '/tickets?page=0');
  check('page=0 → 400', pagV1.status === 400);

  const pagV2 = await req('GET', '/tickets?page=-1');
  check('page=-1 → 400', pagV2.status === 400);

  const pagV3 = await req('GET', '/tickets?limit=0');
  check('limit=0 → 400', pagV3.status === 400);

  const pagV4 = await req('GET', '/tickets?limit=101');
  check('limit=101 → 400', pagV4.status === 400);

  const pagV5 = await req('GET', '/tickets?page=abc');
  check('page=abc → 400', pagV5.status === 400);

  const pagV6 = await req('GET', '/tickets?limit=xyz');
  check('limit=xyz → 400', pagV6.status === 400);

  // 15. Queue order verification
  console.log('\n15. Queue order verification');
  const queueOrdered = await req('GET', '/tickets');
  check('Urgent first in queue', queueOrdered.data.tickets[0].priority === 'urgent');
  const priorities = queueOrdered.data.tickets.map(t => t.priority);
  const urgentIdx = priorities.indexOf('urgent');
  const normalIdx = priorities.indexOf('normal');
  check('Urgent before normal', urgentIdx < normalIdx);

  // 16. Timestamps are ISO 8601 UTC
  console.log('\n16. Timestamp format');
  const ts = await req('GET', `/tickets/${t1.data.id}`);
  const ca = new Date(ts.data.createdAt);
  const rd = new Date(ts.data.responseDueAt);
  check('createdAt is valid ISO 8601', ca.toISOString() === ts.data.createdAt);
  check('responseDueAt is valid ISO 8601', rd.toISOString() === ts.data.responseDueAt);

  // 17. Error response format
  console.log('\n17. Error response format');
  const errRes = await req('POST', '/tickets', { title: 'X', priority: 'urgent' });
  check('Error has { error: string }', typeof errRes.data.error === 'string');

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
