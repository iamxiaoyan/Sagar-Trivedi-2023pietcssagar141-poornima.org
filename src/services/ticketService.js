/**
 * Ticket Service
 *
 * In-memory storage and business logic for helpdesk tickets.
 * All data lives in a plain array — no database required.
 */

const { createTicket, isOverdue } = require('../models/ticket');
const { sortQueue } = require('../utils/queueSorter');

// In-memory ticket store
const tickets = [];

/**
 * Add a new ticket to the store.
 * @param {Object} data - Validated ticket input
 * @returns {Object} The newly created ticket
 */
function addTicket(data) {
  const ticket = createTicket(data);
  tickets.push(ticket);
  return ticket;
}

/**
 * Find a single ticket by its id.
 * @param {string} id
 * @returns {Object|undefined}
 */
function getTicketById(id) {
  return tickets.find((t) => t.id === id);
}

/**
 * Update the assignedTo field of an existing ticket.
 * @param {string} id
 * @param {string|null} assignedTo
 * @returns {Object|null} Updated ticket, or null if not found
 */
function assignTicket(id, assignedTo) {
  const ticket = getTicketById(id);
  if (!ticket) return null;
  ticket.assignedTo = assignedTo ? assignedTo.trim() : null;
  return ticket;
}

/**
 * Retrieve tickets with optional filters, proper queue ordering,
 * and pagination.
 *
 * Processing order (per spec):
 *   1. Retrieve all tickets
 *   2. Apply filters (customerName, assignedTo, overdue)
 *   3. Determine overdue status from current time
 *   4. Sort into queue order
 *   5. Paginate
 *   6. Return result with metadata
 *
 * @param {Object} options
 * @param {string}  [options.customerName]  - Filter by customer (case-insensitive)
 * @param {string}  [options.assignedTo]    - Filter by assignee (case-insensitive)
 * @param {boolean} [options.overdue]       - If true, return only overdue tickets
 * @param {number}  [options.page=1]        - Page number (1-based)
 * @param {number}  [options.limit=10]      - Items per page
 * @param {Date}    [options.now]           - Reference time (for testing)
 * @returns {Object} { page, limit, total, totalPages, tickets }
 */
function getTickets(options = {}) {
  const {
    customerName,
    assignedTo,
    overdue,
    page = 1,
    limit = 10,
    now = new Date(),
  } = options;

  // 1. Start with all tickets
  let result = [...tickets];

  // 2. Apply filters
  if (customerName) {
    const needle = customerName.toLowerCase();
    result = result.filter(
      (t) => t.customerName.toLowerCase() === needle
    );
  }

  if (assignedTo) {
    const needle = assignedTo.toLowerCase();
    result = result.filter(
      (t) => t.assignedTo && t.assignedTo.toLowerCase() === needle
    );
  }

  if (overdue) {
    result = result.filter((t) => isOverdue(t, now));
  }

  // 3-4. Sort into queue order (overdue status determined inside sortQueue)
  result = sortQueue(result, now);

  // 5. Paginate
  const total = result.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const paginatedTickets = result.slice(start, start + limit);

  // 6. Return result with metadata
  return {
    page,
    limit,
    total,
    totalPages,
    tickets: paginatedTickets,
  };
}

/**
 * Remove all tickets (used in tests).
 */
function clearAll() {
  tickets.length = 0;
}

module.exports = {
  addTicket,
  getTicketById,
  assignTicket,
  getTickets,
  clearAll,
};
