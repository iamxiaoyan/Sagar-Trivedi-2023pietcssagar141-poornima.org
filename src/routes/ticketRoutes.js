/**
 * Ticket Routes
 *
 * Maps HTTP methods and paths to controller handlers.
 */

const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

// Create a new ticket
router.post('/', ticketController.createTicket);

// Get only overdue tickets (must be defined BEFORE /:id to avoid collision)
router.get('/overdue', ticketController.getOverdueTickets);

// Get all tickets (with optional filters & pagination)
router.get('/', ticketController.getTickets);

// Get a single ticket by id
router.get('/:id', ticketController.getTicketById);

// Assign / reassign a ticket
router.patch('/:id/assign', ticketController.assignTicket);

module.exports = router;
