# Helpdesk Ticket Management API

A REST API built with **Node.js** and **Express** for managing helpdesk tickets with priority-based queue ordering. Overdue tickets automatically jump to the front of the queue.

## Features

- **Create tickets** with automatic deadline calculation
- **Automated breach escalation** every minute: overdue tickets advance one
  level (normal to high to urgent) without changing their agreed deadline
- **Priority queue** — overdue tickets always appear first
- **Response-time policy** — urgent: 2 hours, normal: 24 hours
- **Filter** by customer name, assignee, or overdue status
- **Assign / reassign** tickets to any helpdesk employee
- **Pagination** with configurable page size and metadata
- **Validation** on all inputs with proper HTTP error codes
- **In-memory storage** — no database setup required

## Queue Ordering Rules

Tickets are sorted using these rules (highest priority first):

1. **Overdue first** — any ticket past its `responseDueAt` jumps to the front
2. **Priority** — `urgent` before `normal`
3. **Earlier deadline** — tickets closer to their deadline are more pressing
4. **Earlier creation** — first-come, first-served when deadlines match

> A ticket is overdue when `currentTime > responseDueAt` (strictly greater than). A ticket exactly at its deadline is **not** overdue.

## Prerequisites

- **[Node.js](https://nodejs.org/)** v16 or later (includes npm)

Verify installation:

```bash
node -v
npm -v
```

## Installation & Setup

```bash
# 1. Navigate to the project folder
cd helpdesk-api

# 2. Install dependencies
npm install
```

That's it — no database, no environment variables, no extra configuration needed.

## How to Run

```bash
npm start
```

Output:

```
Server running on http://localhost:3000
```

The server runs on port **3000** by default. To use a different port:

```bash
# Windows PowerShell
$env:PORT=4000; npm start

# Windows Command Prompt
set PORT=4000 && npm start

# Linux / macOS
PORT=4000 npm start
```

## How to Test

```bash
npm test
```

Runs **66 automated tests** covering:

- Ticket creation & validation
- Deadline calculation (urgent = +2h, normal = +24h)
- Overdue detection (including exactly-at-deadline edge case)
- Queue ordering (all 4 sorting levels)
- Customer-name filtering (case-insensitive)
- Assignment & reassignment
- Assignee filtering
- Pagination & metadata
- Large ticket lists (200 tickets)
- No hard-coded employee names

Expected output:

```
Test Suites: 1 passed, 1 total
Tests:       66 passed, 66 total
```

## API Endpoints

### 1. Create a Ticket

```
POST /tickets
Content-Type: application/json
```

**Request body:**

```json
{
  "customerName": "Rahul",
  "title": "Cannot log in to my account",
  "priority": "urgent",
  "assignedTo": "Priya"
}
```

| Field          | Required | Notes                                  |
| -------------- | -------- | -------------------------------------- |
| `customerName` | Yes      | Non-blank string                       |
| `title`        | Yes      | Non-blank string                       |
| `priority`     | Yes      | `"urgent"` or `"normal"` only          |
| `assignedTo`   | No       | Non-blank string or omit (defaults to `null`) |

**Response:** `201 Created`

```json
{
  "id": "b3f1a2d4-7e89-4c56-a123-9f8e7d6c5b4a",
  "customerName": "Rahul",
  "title": "Cannot log in to my account",
  "priority": "urgent",
  "createdAt": "2026-09-16T09:25:00.000Z",
  "responseDueAt": "2026-09-16T11:25:00.000Z",
  "assignedTo": "Priya"
}
```

> `createdAt` and `responseDueAt` are generated automatically in UTC. The deadline is calculated as:
> - **urgent** → `createdAt + 2 hours`
> - **normal** → `createdAt + 24 hours`

---

### 2. Get Ticket Queue

```
GET /tickets
```

Returns all tickets in priority queue order with pagination.

**Query parameters:**

| Parameter      | Default | Description                             |
| -------------- | ------- | --------------------------------------- |
| `page`         | 1       | Page number (integer ≥ 1)               |
| `limit`        | 10      | Items per page (integer 1–100)          |
| `customerName` | —       | Filter by customer (case-insensitive)   |
| `assignedTo`   | —       | Filter by assignee (case-insensitive)   |
| `overdue`      | —       | Set to `"true"` for only overdue tickets |

**Example:**

```
GET /tickets?customerName=Rahul&page=1&limit=5
```

**Response:** `200 OK`

```json
{
  "page": 1,
  "limit": 5,
  "total": 2,
  "totalPages": 1,
  "tickets": [
    {
      "id": "b3f1a2d4-...",
      "customerName": "Rahul",
      "title": "Cannot log in to my account",
      "priority": "urgent",
      "createdAt": "2026-09-16T09:25:00.000Z",
      "responseDueAt": "2026-09-16T11:25:00.000Z",
      "assignedTo": "Priya"
    },
    {
      "id": "c4e2b3a5-...",
      "customerName": "Rahul",
      "title": "Billing question",
      "priority": "normal",
      "createdAt": "2026-09-16T10:00:00.000Z",
      "responseDueAt": "2026-09-17T10:00:00.000Z",
      "assignedTo": null
    }
  ]
}
```

---

### 3. Get Overdue Tickets

```
GET /tickets/overdue
```

Returns only tickets whose response deadline has passed. Supports `page` and `limit` query parameters.

**Example:**

```
GET /tickets/overdue?page=1&limit=10
```

This can also be done via the main endpoint:

```
GET /tickets?overdue=true
```

---

### 4. Get a Single Ticket

```
GET /tickets/:id
```

**Response:** `200 OK` with the ticket object, or `404 Not Found`:

```json
{ "error": "Ticket not found." }
```

---

### 5. Assign / Reassign a Ticket

```
PATCH /tickets/:id/assign
Content-Type: application/json
```

**Assign to an employee:**

```json
{ "assignedTo": "Deepak" }
```

**Unassign (remove assignment):**

```json
{ "assignedTo": null }
```

**Response:** `200 OK` with the updated ticket, or `404 Not Found`.

---

### 6. Filter by Assignee

```
GET /tickets?assignedTo=Deepak
```

Returns all tickets assigned to that person (case-insensitive). Any valid name works — no hard-coded employees.

---

## Validation & Error Codes

| Scenario                         | HTTP Status |
| -------------------------------- | ----------- |
| Successful creation              | `201`       |
| Successful retrieval / update    | `200`       |
| Missing or blank `customerName`  | `400`       |
| Missing or blank `title`         | `400`       |
| Invalid `priority`               | `400`       |
| Blank `assignedTo` (if provided) | `400`       |
| `page` < 1 or non-integer       | `400`       |
| `limit` < 1, > 100, or non-integer | `400`    |
| Ticket ID not found              | `404`       |
| Unexpected server error          | `500`       |

**Example error response:**

```json
{ "error": "customerName is required and must not be blank." }
```

## Debugging & Troubleshooting

### Server won't start

```
Error: listen EADDRINUSE :::3000
```

Port 3000 is already in use. Either stop the other process or use a different port:

```bash
$env:PORT=4000; npm start
```

### `npm start` shows "Cannot find module"

Dependencies are not installed. Run:

```bash
npm install
```

### Tests fail with "jest is not recognized"

This is a Windows PATH issue. The project uses `npx jest` in the test script to handle this. If it still fails, run directly:

```bash
npx jest --verbose --forceExit
```

### Requests return empty ticket list

Tickets are stored **in memory** — they reset every time the server restarts. Create tickets again after restarting.

### Overdue tickets not showing up

Tickets are only overdue **after** their deadline passes:
- **Urgent** tickets become overdue **2 hours** after creation
- **Normal** tickets become overdue **24 hours** after creation

Check `responseDueAt` on your ticket to see when it will become overdue.

### curl commands not working on Windows

Use double quotes for JSON and escape inner quotes:

```bash
curl -X POST http://localhost:3000/tickets -H "Content-Type: application/json" -d "{\"customerName\":\"Rahul\",\"title\":\"Test\",\"priority\":\"urgent\"}"
```

Or use **Postman** — set method to POST, body to raw JSON.

## Project Structure

```
helpdesk-api/
├── src/
│   ├── app.js                    # Express app & error handling
│   ├── controllers/
│   │   └── ticketController.js   # Request validation & response handling
│   ├── routes/
│   │   └── ticketRoutes.js       # Route definitions
│   ├── services/
│   │   └── ticketService.js      # Business logic & in-memory store
│   ├── models/
│   │   └── ticket.js             # Ticket factory & overdue check
│   └── utils/
│       └── queueSorter.js        # Priority queue sorting algorithm
├── tests/
│   └── ticket.test.js            # 66 automated tests
├── .gitignore
├── package.json
└── README.md
```

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **ID Generation:** uuid
- **Testing:** Jest + Supertest
- **Storage:** In-memory (no database)
