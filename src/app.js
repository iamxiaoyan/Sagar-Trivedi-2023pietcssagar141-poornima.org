/**
 * Helpdesk Ticket Management API
 *
 * Entry point.  Creates the Express app and mounts ticket routes.
 */

const express = require('express');
const ticketRoutes = require('./routes/ticketRoutes');

const app = express();

// Parse JSON request bodies
app.use(express.json());

// Mount ticket routes under /tickets
app.use('/tickets', ticketRoutes);

// Health check
app.get('/', (_req, res) => {
  res.json({ message: 'Helpdesk Ticket API is running.' });
});

// ── Global error handler ────────────────────────────────────────────
// Catches any unexpected errors so the server doesn't crash.
// Must have 4 parameters for Express to recognise it as error middleware.
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// Start server only when run directly (not during tests)
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export for supertest
module.exports = app;
