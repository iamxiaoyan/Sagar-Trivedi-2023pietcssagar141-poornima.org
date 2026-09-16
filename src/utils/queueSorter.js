/**
 * Queue Sorter
 *
 * Sorts tickets into the correct helpdesk queue order.
 *
 * ── Ordering rules (most important first) ──────────────────────────
 *
 * 1. Overdue first
 *    Any ticket whose promised response time has passed (current time >
 *    responseDueAt) jumps to the front of the queue.
 *
 * 2. Priority within each group
 *    "urgent" tickets come before "normal" tickets.
 *
 * 3. Tie-breaker #1 – earlier deadline first
 *    Tickets with an earlier responseDueAt are more pressing.
 *
 * 4. Tie-breaker #2 – earlier creation first
 *    If two tickets share the same deadline, the one created earlier
 *    comes first (first-come, first-served).
 *
 * These rules produce a deterministic, stable order for any set of
 * tickets at any point in time.
 * ────────────────────────────────────────────────────────────────────
 */

const { isOverdue } = require('../models/ticket');

// Lower number = higher priority in sort
const PRIORITY_RANK = {
  urgent: 0,
  normal: 1,
};

/**
 * Sort an array of tickets into the correct queue order.
 *
 * @param {Object[]} tickets - Array of ticket objects
 * @param {Date}     [now=new Date()] - Reference time for overdue calculation
 * @returns {Object[]} A new array sorted in queue order (does NOT mutate input)
 */
function sortQueue(tickets, now = new Date()) {
  // Create a shallow copy so we never mutate the caller's array
  return [...tickets].sort((a, b) => {
    const aOverdue = isOverdue(a, now);
    const bOverdue = isOverdue(b, now);

    // 1. Overdue tickets come first
    if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }

    // 2. Higher priority (urgent) comes first
    const aPriority = PRIORITY_RANK[a.priority];
    const bPriority = PRIORITY_RANK[b.priority];
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // 3. Earlier deadline is more pressing
    const aDue = new Date(a.responseDueAt).getTime();
    const bDue = new Date(b.responseDueAt).getTime();
    if (aDue !== bDue) {
      return aDue - bDue;
    }

    // 4. Earlier creation wins ties
    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    return aCreated - bCreated;
  });
}

module.exports = { sortQueue };
