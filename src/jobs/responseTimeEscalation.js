/**
 * Response-time escalation job
 *
 * Checks the in-memory queue once per minute and escalates every ticket that
 * has passed its agreed response deadline by no more than one priority level.
 */

const ticketService = require('../services/ticketService');

const ESCALATION_INTERVAL_MS = 60 * 1000;

function startResponseTimeEscalation() {
  ticketService.escalateBreachedTickets();

  const interval = setInterval(() => {
    ticketService.escalateBreachedTickets();
  }, ESCALATION_INTERVAL_MS);

  // The timer must not keep short-lived processes (including tests) alive.
  interval.unref();
  return interval;
}

module.exports = {
  ESCALATION_INTERVAL_MS,
  startResponseTimeEscalation,
};
