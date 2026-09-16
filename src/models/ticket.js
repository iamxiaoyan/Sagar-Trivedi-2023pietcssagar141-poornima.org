/**
 * Ticket Model
 *
 * Represents a helpdesk ticket with the following fields:
 *   - id:             Unique identifier (UUID)
 *   - customerName:   Name of the customer who raised the ticket
 *   - title:          Short description / title of the issue
 *   - priority:       "urgent" or "normal"
 *   - createdAt:      ISO 8601 UTC timestamp of when the ticket was created
 *   - responseDueAt:  ISO 8601 UTC deadline calculated from priority:
 *                       urgent  → createdAt + 2 hours
 *                       normal  → createdAt + 24 hours
 *   - assignedTo:     Name of the helpdesk employee assigned (null if unassigned)
 */

const { v4: uuidv4 } = require('uuid');

// Response-time policy (in milliseconds)
const RESPONSE_TIME_MS = {
  urgent: 2 * 60 * 60 * 1000,   // 2 hours
  normal: 24 * 60 * 60 * 1000,  // 24 hours
};

const VALID_PRIORITIES = ['urgent', 'normal'];

/**
 * Create a new ticket object from validated input.
 *
 * @param {Object} data - { customerName, title, priority, assignedTo? }
 * @returns {Object} A fully-formed ticket object
 */
function createTicket(data) {
  const now = new Date();
  const offsetMs = RESPONSE_TIME_MS[data.priority];

  return {
    id: uuidv4(),
    customerName: data.customerName.trim(),
    title: data.title.trim(),
    priority: data.priority,
    createdAt: now.toISOString(),
    responseDueAt: new Date(now.getTime() + offsetMs).toISOString(),
    assignedTo: data.assignedTo ? data.assignedTo.trim() : null,
  };
}

/**
 * Check whether a ticket is overdue at a given point in time.
 * A ticket is overdue when: currentTime > responseDueAt  (strictly greater).
 *
 * @param {Object} ticket
 * @param {Date}   [now=new Date()] - The reference time (defaults to current time)
 * @returns {boolean}
 */
function isOverdue(ticket, now = new Date()) {
  return now.getTime() > new Date(ticket.responseDueAt).getTime();
}

module.exports = {
  createTicket,
  isOverdue,
  VALID_PRIORITIES,
  RESPONSE_TIME_MS,
};
