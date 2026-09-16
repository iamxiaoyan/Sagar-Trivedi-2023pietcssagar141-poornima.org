/**
 * Ticket Controller
 *
 * Handles HTTP request/response logic and input validation.
 * Delegates business logic to ticketService.
 */

const ticketService = require('../services/ticketService');
const { VALID_PRIORITIES } = require('../models/ticket');

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Return a 400 error response.
 */
function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * Parse a positive integer from a string.  Returns NaN on failure.
 */
function parsePositiveInt(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return NaN;
  return num;
}

/**
 * Validate and parse pagination query params (page, limit).
 * Returns { page, limit } on success, or sends a 400 response and returns null.
 */
function parsePagination(req, res) {
  let page = 1;
  if (req.query.page !== undefined) {
    page = parsePositiveInt(req.query.page);
    if (isNaN(page)) {
      badRequest(res, 'page must be an integer >= 1.');
      return null;
    }
  }

  let limit = 10;
  if (req.query.limit !== undefined) {
    limit = parsePositiveInt(req.query.limit);
    if (isNaN(limit)) {
      badRequest(res, 'limit must be an integer >= 1.');
      return null;
    }
    if (limit > 100) {
      badRequest(res, 'limit must not exceed 100.');
      return null;
    }
  }

  return { page, limit };
}

/**
 * Validate that a string field is present and non-blank.
 * Returns true if valid, false (and sends 400) if invalid.
 */
function requireNonBlankString(res, value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    badRequest(res, `${fieldName} is required and must not be blank.`);
    return false;
  }
  return true;
}

// ── Route handlers ──────────────────────────────────────────────────

/**
 * POST /tickets
 *
 * Create a new ticket.
 * Body: { customerName, title, priority, assignedTo? }
 */
function createTicket(req, res) {
  const { customerName, title, priority, assignedTo } = req.body;

  // Validate required string fields
  if (!requireNonBlankString(res, customerName, 'customerName')) return;
  if (!requireNonBlankString(res, title, 'title')) return;

  // Validate priority
  if (!priority || !VALID_PRIORITIES.includes(priority)) {
    return badRequest(
      res,
      `priority is required and must be one of: ${VALID_PRIORITIES.join(', ')}.`
    );
  }

  // Validate assignedTo (optional, but if provided must be non-blank string)
  if (assignedTo !== undefined && assignedTo !== null) {
    if (typeof assignedTo !== 'string' || !assignedTo.trim()) {
      return badRequest(res, 'assignedTo must be a non-blank string if provided.');
    }
  }

  const ticket = ticketService.addTicket({
    customerName,
    title,
    priority,
    assignedTo: assignedTo || null,
  });

  return res.status(201).json(ticket);
}

/**
 * GET /tickets
 *
 * Retrieve tickets in queue order with optional filters and pagination.
 *
 * Query params:
 *   customerName  - filter by customer (case-insensitive exact match)
 *   assignedTo    - filter by assignee (case-insensitive exact match)
 *   overdue       - "true" to return only overdue tickets
 *   page          - page number (default 1, min 1)
 *   limit         - items per page (default 10, min 1, max 100)
 */
function getTickets(req, res) {
  const { customerName, assignedTo, overdue } = req.query;

  const pagination = parsePagination(req, res);
  if (!pagination) return; // 400 already sent

  const result = ticketService.getTickets({
    customerName: customerName || undefined,
    assignedTo: assignedTo || undefined,
    overdue: overdue === 'true',
    page: pagination.page,
    limit: pagination.limit,
  });

  return res.json(result);
}

/**
 * GET /tickets/overdue
 *
 * Convenience endpoint: returns only overdue tickets in queue order.
 * Supports pagination (page, limit).
 */
function getOverdueTickets(req, res) {
  const pagination = parsePagination(req, res);
  if (!pagination) return; // 400 already sent

  const result = ticketService.getTickets({
    overdue: true,
    page: pagination.page,
    limit: pagination.limit,
  });

  return res.json(result);
}

/**
 * GET /tickets/:id
 *
 * Retrieve a single ticket by its id.
 */
function getTicketById(req, res) {
  const ticket = ticketService.getTicketById(req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }
  return res.json(ticket);
}

/**
 * PATCH /tickets/:id/assign
 *
 * Assign or reassign a ticket.
 * Body: { assignedTo: "Name" }   — set to null to unassign.
 */
function assignTicket(req, res) {
  const { assignedTo } = req.body;

  // assignedTo must be present in body (can be null to unassign)
  if (assignedTo === undefined) {
    return badRequest(res, 'assignedTo is required in the request body.');
  }

  // If not null, must be a non-blank string
  if (assignedTo !== null) {
    if (typeof assignedTo !== 'string' || !assignedTo.trim()) {
      return badRequest(res, 'assignedTo must be a non-blank string or null.');
    }
  }

  const ticket = ticketService.assignTicket(req.params.id, assignedTo);
  if (!ticket) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }
  return res.json(ticket);
}

module.exports = {
  createTicket,
  getTickets,
  getOverdueTickets,
  getTicketById,
  assignTicket,
};
