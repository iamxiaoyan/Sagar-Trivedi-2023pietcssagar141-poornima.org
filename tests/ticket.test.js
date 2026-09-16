/**
 * Helpdesk Ticket API – Test Suite
 *
 * Covers every requirement and edge case listed in the specification:
 *
 *   ✓ Ticket creation & validation
 *   ✓ Deadline calculation (urgent = +2h, normal = +24h)
 *   ✓ Overdue detection (including exactly-at-deadline)
 *   ✓ Queue ordering (overdue → priority → deadline → createdAt)
 *   ✓ Customer-name filtering (case-insensitive)
 *   ✓ Assignment & reassignment
 *   ✓ Assignee filtering (case-insensitive)
 *   ✓ Pagination & metadata
 *   ✓ Edge cases (empty list, large lists, beyond-last-page, etc.)
 *   ✓ No hard-coded employee names
 */

const request = require('supertest');
const app = require('../src/app');
const ticketService = require('../src/services/ticketService');
const { isOverdue, RESPONSE_TIME_MS } = require('../src/models/ticket');
const { sortQueue } = require('../src/utils/queueSorter');
const { startResponseTimeEscalation } = require('../src/jobs/responseTimeEscalation');

// Reset the in-memory store before each test
beforeEach(() => {
  ticketService.clearAll();
});

// ─────────────────────────────────────────────────────────────────────
//  1. TICKET CREATION
// ─────────────────────────────────────────────────────────────────────

describe('POST /tickets – creation', () => {
  test('creates a valid ticket with all required fields', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'Rahul', title: 'Login issue', priority: 'urgent' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.customerName).toBe('Rahul');
    expect(res.body.title).toBe('Login issue');
    expect(res.body.priority).toBe('urgent');
    expect(res.body.createdAt).toBeDefined();
    expect(res.body.responseDueAt).toBeDefined();
    expect(res.body.assignedTo).toBeNull();
  });

  test('creates a ticket with assignedTo', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({
        customerName: 'Amit',
        title: 'Slow dashboard',
        priority: 'normal',
        assignedTo: 'Deepak',
      });

    expect(res.status).toBe(201);
    expect(res.body.assignedTo).toBe('Deepak');
  });

  test('urgent deadline = createdAt + 2 hours', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent' });

    const created = new Date(res.body.createdAt).getTime();
    const due = new Date(res.body.responseDueAt).getTime();
    expect(due - created).toBe(RESPONSE_TIME_MS.urgent); // 2 hours
  });

  test('normal deadline = createdAt + 24 hours', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'normal' });

    const created = new Date(res.body.createdAt).getTime();
    const due = new Date(res.body.responseDueAt).getTime();
    expect(due - created).toBe(RESPONSE_TIME_MS.normal); // 24 hours
  });
});

// ─────────────────────────────────────────────────────────────────────
//  2. CREATION VALIDATION
// ─────────────────────────────────────────────────────────────────────

describe('POST /tickets – validation', () => {
  test('rejects missing customerName', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ title: 'X', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  test('rejects blank customerName', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: '   ', title: 'X', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  test('rejects missing title', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  test('rejects blank title', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: '', priority: 'urgent' });
    expect(res.status).toBe(400);
  });

  test('rejects invalid priority', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'high' });
    expect(res.status).toBe(400);
  });

  test('rejects missing priority', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B' });
    expect(res.status).toBe(400);
  });

  test('rejects blank assignedTo string', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent', assignedTo: '  ' });
    expect(res.status).toBe(400);
  });

  test('accepts null assignedTo', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent', assignedTo: null });
    expect(res.status).toBe(201);
    expect(res.body.assignedTo).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  3. OVERDUE DETECTION (unit tests on isOverdue)
// ─────────────────────────────────────────────────────────────────────

describe('isOverdue()', () => {
  const ticket = {
    responseDueAt: '2026-09-16T12:00:00.000Z',
  };

  test('not overdue when current time is before deadline', () => {
    const before = new Date('2026-09-16T11:59:59.000Z');
    expect(isOverdue(ticket, before)).toBe(false);
  });

  test('NOT overdue exactly at the deadline (not strictly greater)', () => {
    const exact = new Date('2026-09-16T12:00:00.000Z');
    expect(isOverdue(ticket, exact)).toBe(false);
  });

  test('overdue one second past the deadline', () => {
    const oneSecAfter = new Date('2026-09-16T12:00:01.000Z');
    expect(isOverdue(ticket, oneSecAfter)).toBe(true);
  });

  test('overdue one millisecond past the deadline', () => {
    const oneMs = new Date('2026-09-16T12:00:00.001Z');
    expect(isOverdue(ticket, oneMs)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  4. QUEUE ORDERING (unit tests on sortQueue)
// ─────────────────────────────────────────────────────────────────────

describe('sortQueue()', () => {
  // Helper to make a minimal ticket-like object
  function t(id, priority, responseDueAt, createdAt) {
    return { id, priority, responseDueAt, createdAt };
  }

  test('overdue tickets come before non-overdue tickets', () => {
    const now = new Date('2026-09-16T15:00:00.000Z');
    const tickets = [
      t('still-ok', 'urgent', '2026-09-16T16:00:00.000Z', '2026-09-16T14:00:00.000Z'),
      t('overdue', 'normal', '2026-09-16T14:00:00.000Z', '2026-09-16T13:00:00.000Z'),
    ];
    const sorted = sortQueue(tickets, now);
    expect(sorted[0].id).toBe('overdue');
    expect(sorted[1].id).toBe('still-ok');
  });

  test('urgent comes before normal within the same overdue group', () => {
    const now = new Date('2026-09-16T20:00:00.000Z');
    const tickets = [
      t('normal-overdue', 'normal', '2026-09-16T18:00:00.000Z', '2026-09-16T10:00:00.000Z'),
      t('urgent-overdue', 'urgent', '2026-09-16T18:00:00.000Z', '2026-09-16T16:00:00.000Z'),
    ];
    const sorted = sortQueue(tickets, now);
    expect(sorted[0].id).toBe('urgent-overdue');
    expect(sorted[1].id).toBe('normal-overdue');
  });

  test('earlier deadline comes first when same priority', () => {
    const now = new Date('2026-09-16T10:00:00.000Z');
    const tickets = [
      t('later-due', 'urgent', '2026-09-16T14:00:00.000Z', '2026-09-16T09:00:00.000Z'),
      t('sooner-due', 'urgent', '2026-09-16T12:00:00.000Z', '2026-09-16T09:30:00.000Z'),
    ];
    const sorted = sortQueue(tickets, now);
    expect(sorted[0].id).toBe('sooner-due');
    expect(sorted[1].id).toBe('later-due');
  });

  test('earlier creation breaks deadline ties', () => {
    const now = new Date('2026-09-16T10:00:00.000Z');
    const sameDue = '2026-09-16T12:00:00.000Z';
    const tickets = [
      t('created-later', 'urgent', sameDue, '2026-09-16T10:00:00.000Z'),
      t('created-earlier', 'urgent', sameDue, '2026-09-16T09:00:00.000Z'),
    ];
    const sorted = sortQueue(tickets, now);
    expect(sorted[0].id).toBe('created-earlier');
    expect(sorted[1].id).toBe('created-later');
  });

  test('full ordering: overdue-urgent → overdue-normal → ok-urgent → ok-normal', () => {
    const now = new Date('2026-09-16T15:00:00.000Z');
    const tickets = [
      t('ok-normal', 'normal', '2026-09-17T10:00:00.000Z', '2026-09-16T10:00:00.000Z'),
      t('ok-urgent', 'urgent', '2026-09-16T16:00:00.000Z', '2026-09-16T14:00:00.000Z'),
      t('overdue-normal', 'normal', '2026-09-16T14:00:00.000Z', '2026-09-15T14:00:00.000Z'),
      t('overdue-urgent', 'urgent', '2026-09-16T13:00:00.000Z', '2026-09-16T11:00:00.000Z'),
    ];
    const sorted = sortQueue(tickets, now);
    expect(sorted.map((s) => s.id)).toEqual([
      'overdue-urgent',
      'overdue-normal',
      'ok-urgent',
      'ok-normal',
    ]);
  });

  test('handles empty array', () => {
    expect(sortQueue([], new Date())).toEqual([]);
  });

  test('does not mutate the input array', () => {
    const tickets = [
      t('b', 'normal', '2026-09-17T10:00:00.000Z', '2026-09-16T10:00:00.000Z'),
      t('a', 'urgent', '2026-09-16T12:00:00.000Z', '2026-09-16T10:00:00.000Z'),
    ];
    const copy = [...tickets];
    sortQueue(tickets, new Date('2026-09-16T10:00:00.000Z'));
    expect(tickets).toEqual(copy);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  5. GET /tickets – QUEUE ORDER VIA API
// ─────────────────────────────────────────────────────────────────────

describe('GET /tickets – queue ordering via API', () => {
  test('returns tickets in correct queue order', async () => {
    // Create tickets in non-priority order
    await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'Normal ticket', priority: 'normal' });

    // Wait 10ms to ensure distinct createdAt
    await new Promise((r) => setTimeout(r, 10));

    await request(app)
      .post('/tickets')
      .send({ customerName: 'B', title: 'Urgent ticket', priority: 'urgent' });

    const res = await request(app).get('/tickets');

    expect(res.status).toBe(200);
    // Urgent should appear before normal (neither is overdue yet)
    expect(res.body.tickets[0].priority).toBe('urgent');
    expect(res.body.tickets[1].priority).toBe('normal');
  });

  test('empty ticket list returns valid structure', async () => {
    const res = await request(app).get('/tickets');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.totalPages).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  6. OVERDUE TICKETS ENDPOINT
// ─────────────────────────────────────────────────────────────────────

describe('GET /tickets/overdue', () => {
  test('returns empty list when no tickets are overdue', async () => {
    await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent' });

    const res = await request(app).get('/tickets/overdue');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('GET /tickets?overdue=true', () => {
  test('overdue filter also works as a query parameter', async () => {
    await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent' });

    const res = await request(app).get('/tickets?overdue=true');
    expect(res.status).toBe(200);
    // Ticket just created is not overdue yet
    expect(res.body.tickets).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  7. OVERDUE DETECTION THROUGH SERVICE (with time manipulation)
// ─────────────────────────────────────────────────────────────────────

describe('Overdue detection via service', () => {
  test('urgent ticket is overdue after 2 hours', () => {
    const ticket = ticketService.addTicket({
      customerName: 'X',
      title: 'Y',
      priority: 'urgent',
    });
    const futureTime = new Date(
      new Date(ticket.createdAt).getTime() + RESPONSE_TIME_MS.urgent + 1000
    );

    const result = ticketService.getTickets({ overdue: true, now: futureTime });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].id).toBe(ticket.id);
  });

  test('normal ticket is overdue after 24 hours', () => {
    const ticket = ticketService.addTicket({
      customerName: 'X',
      title: 'Y',
      priority: 'normal',
    });
    const futureTime = new Date(
      new Date(ticket.createdAt).getTime() + RESPONSE_TIME_MS.normal + 1000
    );

    const result = ticketService.getTickets({ overdue: true, now: futureTime });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].id).toBe(ticket.id);
  });

  test('ticket exactly at deadline is NOT overdue', () => {
    const ticket = ticketService.addTicket({
      customerName: 'X',
      title: 'Y',
      priority: 'urgent',
    });
    const exactDeadline = new Date(ticket.responseDueAt);

    const result = ticketService.getTickets({ overdue: true, now: exactDeadline });
    expect(result.tickets).toHaveLength(0);
  });

  test('multiple overdue tickets are returned', () => {
    const t1 = ticketService.addTicket({ customerName: 'A', title: 'T1', priority: 'urgent' });
    const t2 = ticketService.addTicket({ customerName: 'B', title: 'T2', priority: 'normal' });

    // Move to a time when both are overdue
    const futureTime = new Date(
      new Date(t2.createdAt).getTime() + RESPONSE_TIME_MS.normal + 1000
    );

    const result = ticketService.getTickets({ overdue: true, now: futureTime });
    expect(result.tickets).toHaveLength(2);
  });

  test('overdue tickets jump to front of queue', () => {
    const t1 = ticketService.addTicket({ customerName: 'A', title: 'Urgent ok', priority: 'urgent' });
    const t2 = ticketService.addTicket({ customerName: 'B', title: 'Normal old', priority: 'normal' });

    // Time where normal is overdue but urgent is still ok
    const futureTime = new Date(
      new Date(t1.createdAt).getTime() + RESPONSE_TIME_MS.urgent - 1000
    );
    // But make sure t2 is overdue: we need time > t2.responseDueAt
    // t2.responseDueAt = t2.createdAt + 24h
    // Let's pick a time where: t1 NOT overdue, t2 IS overdue
    // Since t1 and t2 are created almost at the same time, urgent has 2h window, normal has 24h window.
    // After 2h, urgent is overdue. After 24h, normal is overdue.
    // To have normal overdue but urgent NOT overdue, we can't — normal has the longer window.
    // Instead test: urgent overdue but normal not overdue shouldn't happen either.
    // 
    // Let's create proper scenario: create t2 (normal) much earlier using service directly.
    ticketService.clearAll();

    // Simulate old normal ticket created 25 hours ago
    const now = new Date('2026-09-16T15:00:00.000Z');
    const oldNormal = {
      id: 'old-normal',
      customerName: 'B',
      title: 'Normal old',
      priority: 'normal',
      createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
      responseDueAt: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      assignedTo: null,
    };

    // Fresh urgent ticket created just now
    const freshUrgent = {
      id: 'fresh-urgent',
      customerName: 'A',
      title: 'Urgent new',
      priority: 'urgent',
      createdAt: now.toISOString(),
      responseDueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      assignedTo: null,
    };

    // Use sortQueue directly to verify ordering
    const sorted = sortQueue([freshUrgent, oldNormal], now);
    // oldNormal is overdue, freshUrgent is not → overdue comes first
    expect(sorted[0].id).toBe('old-normal');
    expect(sorted[1].id).toBe('fresh-urgent');
  });
});

// ─────────────────────────────────────────────────────────────────────
//  8. CUSTOMER LOOKUP
// ─────────────────────────────────────────────────────────────────────

describe('Response-time escalation', () => {
  test('escalates an overdue normal ticket one level per run without changing its deadline', () => {
    const ticket = ticketService.addTicket({
      customerName: 'A',
      title: 'Breached response time',
      priority: 'normal',
    });
    const originalDueAt = ticket.responseDueAt;
    const afterDeadline = new Date(new Date(originalDueAt).getTime() + 1);

    expect(ticketService.escalateBreachedTickets(afterDeadline)).toEqual([ticket]);
    expect(ticket.priority).toBe('high');
    expect(ticket.responseDueAt).toBe(originalDueAt);

    expect(ticketService.escalateBreachedTickets(afterDeadline)).toEqual([ticket]);
    expect(ticket.priority).toBe('urgent');
    expect(ticketService.escalateBreachedTickets(afterDeadline)).toEqual([]);
  });

  test('does not escalate a ticket that has not breached its agreed response time', () => {
    const ticket = ticketService.addTicket({
      customerName: 'A',
      title: 'Within response time',
      priority: 'normal',
    });

    expect(ticketService.escalateBreachedTickets(new Date(ticket.responseDueAt))).toEqual([]);
    expect(ticket.priority).toBe('normal');
  });

  test('the scheduled check immediately processes existing breached tickets', () => {
    const ticket = ticketService.addTicket({
      customerName: 'A',
      title: 'Scheduled breach',
      priority: 'normal',
    });
    ticket.responseDueAt = new Date(Date.now() - 1).toISOString();

    const interval = startResponseTimeEscalation();

    expect(ticket.priority).toBe('high');
    clearInterval(interval);
  });

  test('places escalated high tickets between urgent and normal tickets in queue order', () => {
    const now = new Date('2026-09-16T12:00:00.000Z');
    const tickets = [
      { id: 'normal', priority: 'normal', createdAt: now.toISOString(), responseDueAt: '2026-09-17T12:00:00.000Z' },
      { id: 'high', priority: 'high', createdAt: now.toISOString(), responseDueAt: '2026-09-17T12:00:00.000Z' },
      { id: 'urgent', priority: 'urgent', createdAt: now.toISOString(), responseDueAt: '2026-09-17T12:00:00.000Z' },
    ];

    expect(sortQueue(tickets, now).map((ticket) => ticket.id)).toEqual([
      'urgent',
      'high',
      'normal',
    ]);
  });
});

describe('GET /tickets?customerName=...', () => {
  beforeEach(async () => {
    await request(app)
      .post('/tickets')
      .send({ customerName: 'Rahul', title: 'Issue 1', priority: 'urgent' });
    await request(app)
      .post('/tickets')
      .send({ customerName: 'Rahul', title: 'Issue 2', priority: 'normal' });
    await request(app)
      .post('/tickets')
      .send({ customerName: 'Amit', title: 'Issue 3', priority: 'urgent' });
  });

  test('returns all tickets for a customer', async () => {
    const res = await request(app).get('/tickets?customerName=Rahul');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    res.body.tickets.forEach((t) => {
      expect(t.customerName).toBe('Rahul');
    });
  });

  test('customer lookup is case-insensitive', async () => {
    const res = await request(app).get('/tickets?customerName=rahul');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  test('returns empty for non-existent customer', async () => {
    const res = await request(app).get('/tickets?customerName=Nobody');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  test('customer with multiple tickets returns them in queue order', async () => {
    const res = await request(app).get('/tickets?customerName=Rahul');
    // urgent should come before normal
    expect(res.body.tickets[0].priority).toBe('urgent');
    expect(res.body.tickets[1].priority).toBe('normal');
  });
});

// ─────────────────────────────────────────────────────────────────────
//  9. ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────

describe('PATCH /tickets/:id/assign', () => {
  let ticketId;

  beforeEach(async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'Rahul', title: 'Issue', priority: 'urgent' });
    ticketId = res.body.id;
  });

  test('assigns a ticket to an employee', async () => {
    const res = await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: 'Deepak' });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe('Deepak');
  });

  test('reassigns a ticket to a different employee', async () => {
    await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: 'Deepak' });

    const res = await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: 'Meera' });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBe('Meera');
  });

  test('unassigns a ticket by setting assignedTo to null', async () => {
    await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: 'Deepak' });

    const res = await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: null });
    expect(res.status).toBe(200);
    expect(res.body.assignedTo).toBeNull();
  });

  test('returns 404 for non-existent ticket', async () => {
    const res = await request(app)
      .patch('/tickets/non-existent-id/assign')
      .send({ assignedTo: 'Deepak' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when assignedTo is missing from body', async () => {
    const res = await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 when assignedTo is blank string', async () => {
    const res = await request(app)
      .patch(`/tickets/${ticketId}/assign`)
      .send({ assignedTo: '  ' });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  10. ASSIGNEE FILTERING
// ─────────────────────────────────────────────────────────────────────

describe('GET /tickets?assignedTo=...', () => {
  beforeEach(async () => {
    const r1 = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'T1', priority: 'urgent', assignedTo: 'Priya' });
    const r2 = await request(app)
      .post('/tickets')
      .send({ customerName: 'B', title: 'T2', priority: 'normal', assignedTo: 'Priya' });
    const r3 = await request(app)
      .post('/tickets')
      .send({ customerName: 'C', title: 'T3', priority: 'urgent', assignedTo: 'Deepak' });
    const r4 = await request(app)
      .post('/tickets')
      .send({ customerName: 'D', title: 'T4', priority: 'normal' }); // unassigned
  });

  test('filters tickets by assignee', async () => {
    const res = await request(app).get('/tickets?assignedTo=Priya');
    expect(res.body.total).toBe(2);
    res.body.tickets.forEach((t) => {
      expect(t.assignedTo).toBe('Priya');
    });
  });

  test('assignee filter is case-insensitive', async () => {
    const res = await request(app).get('/tickets?assignedTo=priya');
    expect(res.body.total).toBe(2);
  });

  test('different assignees work (not hard-coded)', async () => {
    const res = await request(app).get('/tickets?assignedTo=Deepak');
    expect(res.body.total).toBe(1);
    expect(res.body.tickets[0].assignedTo).toBe('Deepak');
  });

  test('unassigned tickets are excluded from assignee filter', async () => {
    const res = await request(app).get('/tickets?assignedTo=Priya');
    res.body.tickets.forEach((t) => {
      expect(t.assignedTo).not.toBeNull();
    });
  });

  test('returns empty for non-existent assignee', async () => {
    const res = await request(app).get('/tickets?assignedTo=Nobody');
    expect(res.body.total).toBe(0);
    expect(res.body.tickets).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  11. GET /tickets/:id
// ─────────────────────────────────────────────────────────────────────

describe('GET /tickets/:id', () => {
  test('returns a ticket by id', async () => {
    const created = await request(app)
      .post('/tickets')
      .send({ customerName: 'X', title: 'Y', priority: 'urgent' });

    const res = await request(app).get(`/tickets/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app).get('/tickets/does-not-exist');
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  12. PAGINATION
// ─────────────────────────────────────────────────────────────────────

describe('GET /tickets – pagination', () => {
  beforeEach(async () => {
    // Create 15 tickets
    for (let i = 1; i <= 15; i++) {
      await request(app)
        .post('/tickets')
        .send({
          customerName: `Customer${i}`,
          title: `Ticket ${i}`,
          priority: i % 2 === 0 ? 'urgent' : 'normal',
        });
    }
  });

  test('defaults to page=1, limit=10', async () => {
    const res = await request(app).get('/tickets');
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.tickets).toHaveLength(10);
    expect(res.body.total).toBe(15);
    expect(res.body.totalPages).toBe(2);
  });

  test('page=2 returns remaining tickets', async () => {
    const res = await request(app).get('/tickets?page=2&limit=10');
    expect(res.body.page).toBe(2);
    expect(res.body.tickets).toHaveLength(5);
  });

  test('custom limit works', async () => {
    const res = await request(app).get('/tickets?limit=5');
    expect(res.body.tickets).toHaveLength(5);
    expect(res.body.totalPages).toBe(3);
  });

  test('page beyond available returns empty tickets', async () => {
    const res = await request(app).get('/tickets?page=100&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.tickets).toEqual([]);
    expect(res.body.total).toBe(15);
  });

  test('pagination metadata is correct', async () => {
    const res = await request(app).get('/tickets?page=1&limit=4');
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(4);
    expect(res.body.total).toBe(15);
    expect(res.body.totalPages).toBe(4); // ceil(15/4) = 4
    expect(res.body.tickets).toHaveLength(4);
  });

  test('rejects page=0', async () => {
    const res = await request(app).get('/tickets?page=0');
    expect(res.status).toBe(400);
  });

  test('rejects negative page', async () => {
    const res = await request(app).get('/tickets?page=-1');
    expect(res.status).toBe(400);
  });

  test('rejects limit=0', async () => {
    const res = await request(app).get('/tickets?limit=0');
    expect(res.status).toBe(400);
  });

  test('rejects limit > 100', async () => {
    const res = await request(app).get('/tickets?limit=101');
    expect(res.status).toBe(400);
  });

  test('rejects non-integer page', async () => {
    const res = await request(app).get('/tickets?page=abc');
    expect(res.status).toBe(400);
  });

  test('rejects non-integer limit', async () => {
    const res = await request(app).get('/tickets?limit=xyz');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  13. FILTERING + PAGINATION TOGETHER
// ─────────────────────────────────────────────────────────────────────

describe('Filtering + pagination', () => {
  beforeEach(async () => {
    // Create 6 tickets for Rahul, 4 for Amit
    for (let i = 1; i <= 6; i++) {
      await request(app)
        .post('/tickets')
        .send({
          customerName: 'Rahul',
          title: `Rahul ticket ${i}`,
          priority: i <= 3 ? 'urgent' : 'normal',
        });
    }
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post('/tickets')
        .send({
          customerName: 'Amit',
          title: `Amit ticket ${i}`,
          priority: 'normal',
        });
    }
  });

  test('pagination applies to filtered results', async () => {
    const res = await request(app).get('/tickets?customerName=Rahul&limit=3&page=1');
    expect(res.body.total).toBe(6);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.tickets).toHaveLength(3);
  });

  test('filtered results maintain queue order', async () => {
    const res = await request(app).get('/tickets?customerName=Rahul');
    // First 3 should be urgent, then 3 normal
    for (let i = 0; i < 3; i++) {
      expect(res.body.tickets[i].priority).toBe('urgent');
    }
    for (let i = 3; i < 6; i++) {
      expect(res.body.tickets[i].priority).toBe('normal');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
//  14. LARGE TICKET LIST
// ─────────────────────────────────────────────────────────────────────

describe('Large ticket list', () => {
  test('handles 200 tickets correctly', async () => {
    for (let i = 0; i < 200; i++) {
      ticketService.addTicket({
        customerName: `Cust${i}`,
        title: `Ticket ${i}`,
        priority: i % 2 === 0 ? 'urgent' : 'normal',
      });
    }

    const res = await request(app).get('/tickets?limit=50&page=1');
    expect(res.body.total).toBe(200);
    expect(res.body.totalPages).toBe(4);
    expect(res.body.tickets).toHaveLength(50);

    // Verify ordering: first ticket on page 1 should be urgent (or overdue-urgent)
    expect(res.body.tickets[0].priority).toBe('urgent');
  });
});

// ─────────────────────────────────────────────────────────────────────
//  15. NO HARD-CODED EMPLOYEE NAMES
// ─────────────────────────────────────────────────────────────────────

describe('No hard-coded employee names', () => {
  test('any assignee name works', async () => {
    const create = await request(app)
      .post('/tickets')
      .send({ customerName: 'X', title: 'Y', priority: 'urgent' });

    const names = ['Alice', 'Bob', 'Carlos', 'Divya', 'Eshan'];

    for (const name of names) {
      const res = await request(app)
        .patch(`/tickets/${create.body.id}/assign`)
        .send({ assignedTo: name });
      expect(res.status).toBe(200);
      expect(res.body.assignedTo).toBe(name);

      const filtered = await request(app).get(`/tickets?assignedTo=${name}`);
      expect(filtered.body.total).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
//  16. TIMESTAMPS ARE UTC / ISO 8601
// ─────────────────────────────────────────────────────────────────────

describe('Timestamps', () => {
  test('createdAt and responseDueAt are valid ISO 8601 strings', async () => {
    const res = await request(app)
      .post('/tickets')
      .send({ customerName: 'A', title: 'B', priority: 'urgent' });

    const createdAt = new Date(res.body.createdAt);
    const responseDueAt = new Date(res.body.responseDueAt);

    expect(createdAt.toISOString()).toBe(res.body.createdAt);
    expect(responseDueAt.toISOString()).toBe(res.body.responseDueAt);
  });
});

// ─────────────────────────────────────────────────────────────────────
//  17. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────

describe('GET /', () => {
  test('returns health check message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });
});
