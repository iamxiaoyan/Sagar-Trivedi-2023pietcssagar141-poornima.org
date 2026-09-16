# Reasoning Behind the Solution

## 1. Problem Understanding

The system manages a helpdesk ticket queue where tickets have different priorities and promised response times. The core business rule is:

> Any ticket that has passed its promised response time must jump to the front of the queue.

This means the queue is **dynamic** — a ticket's position changes over time as deadlines pass. The API must calculate overdue status on every request rather than storing it as a static flag.

The system must be **generic** — it should work with any number of employees, customers, and tickets without hard-coding specific names or behaviors.

## 2. Requirements Identified

From the problem statement, five functional requirements were identified in order of priority:

1. **Create tickets** — with automatic deadline calculation based on priority
2. **Retrieve the queue** — sorted correctly with overdue tickets first
3. **Overdue filtering** — surface tickets that have passed their deadline
4. **Customer and assignee lookup** — filter tickets by name
5. **Assignment** — assign/reassign tickets to any employee

Cross-cutting concerns:

- Input validation with appropriate HTTP status codes (400, 404)
- Pagination for large ticket lists
- Case-insensitive filtering
- Deterministic sort order with documented tie-breaking rules

## 3. Approach Chosen

**Architecture:** Layered MVC pattern with four distinct layers:

```
Routes → Controller → Service → Model/Utils
```

- **Routes** — map HTTP verbs and paths to handlers
- **Controller** — validate input, format responses, return proper status codes
- **Service** — business logic, storage, filtering, orchestrate sorting and pagination
- **Model** — ticket creation factory, overdue check, policy constants
- **Utils** — queue sorting algorithm, decoupled from storage

**Storage:** In-memory JavaScript array.

**Sorting:** Computed on every read request using `Array.sort()` with a multi-level comparator.

**Overdue detection:** Calculated dynamically by comparing the current time against `responseDueAt`. Never stored as a field.

## 4. Why This Approach Was Selected

### In-memory array over a database

The requirements specify a focused API without mentioning persistence. An in-memory array:
- Eliminates setup complexity (no database install, no connection strings)
- Keeps the codebase beginner-readable
- Is sufficient for the assessment scope

### Computed overdue status over stored boolean

Storing `isOverdue` as a field would require a background job or manual trigger to update it when a ticket crosses its deadline. Computing it from `currentTime > responseDueAt` guarantees correctness at any point in time with zero maintenance overhead.

### Sort on read over maintaining a sorted structure

A priority queue or sorted insertion would optimize read performance but add complexity. Since the bottleneck for this use case is correctness (not throughput), sorting on every GET request is simpler, easier to verify, and always reflects the current time accurately.

### Layered architecture over a single file

Separating concerns into model, service, controller, and routes makes each layer independently testable and keeps individual files short. A beginner can trace a request from route → controller → service → model without jumping through abstractions.

## 5. Data Structures & Design Decisions

### Ticket object

```javascript
{
  id:             // UUID v4 — globally unique, no collision risk
  customerName:   // trimmed on creation
  title:          // trimmed on creation
  priority:       // "urgent" | "normal" — validated against whitelist
  createdAt:      // ISO 8601 UTC string — from new Date().toISOString()
  responseDueAt:  // ISO 8601 UTC string — createdAt + policy offset
  assignedTo:     // string | null
}
```

**Why ISO 8601 strings instead of Date objects or timestamps?**
JSON serialization preserves them without transformation. They sort lexicographically in UTC. They are human-readable in API responses.

**Why UUID v4 for IDs?**
Auto-incrementing integers leak information (total ticket count, creation order). UUIDs are standard for REST APIs and avoid conflicts without coordination.

### Response-time policy

```javascript
{ urgent: 2 * 60 * 60 * 1000, normal: 24 * 60 * 60 * 1000 }
```

Defined as a constant map in the model layer. Adding a new priority level requires only adding an entry here and to the `VALID_PRIORITIES` array — no other code changes.

### Queue sort comparator

The comparator applies four levels of comparison in sequence:

```
1. Overdue status  (overdue before non-overdue)
2. Priority rank   (urgent=0, normal=1)
3. responseDueAt   (earlier deadline first)
4. createdAt       (earlier creation first)
```

Each level only applies when the previous level results in a tie. This produces a **deterministic, stable** order for any set of tickets at any point in time.

**Tie-breaking rationale:** Earlier deadline is checked before earlier creation because a ticket closer to (or past) its deadline is objectively more pressing. Creation time is the final fallback to ensure no two tickets can have an ambiguous position.

### Filtering and pagination pipeline

The service processes requests in this exact order:

```
Retrieve all tickets
  → Apply filters (customerName, assignedTo, overdue)
    → Sort into queue order
      → Slice for pagination
        → Return with metadata
```

This order is critical. Paginating before sorting would cause the most pressing ticket to potentially appear on a later page. Filtering after pagination would return incorrect totals.

## 6. Validation & Error-Handling Decisions

### Input validation in the controller layer

Validation lives in the controller (not the model or service) because:
- It is an HTTP concern — it determines the status code (400 vs 201)
- The service layer assumes clean data, keeping it focused on business logic
- Validation errors short-circuit before any state mutation

### Validation rules

| Field          | Rule                              | Rationale                                        |
| -------------- | --------------------------------- | ------------------------------------------------ |
| `customerName` | Required, non-blank string        | A ticket without a customer is meaningless        |
| `title`        | Required, non-blank string        | A ticket needs a description                      |
| `priority`     | Must be `"urgent"` or `"normal"`  | Business rule — only two levels exist             |
| `assignedTo`   | Optional; non-blank if provided   | Unassigned tickets are valid; blank strings are not |
| `page`         | Integer ≥ 1                       | Page 0 or negative is nonsensical                 |
| `limit`        | Integer 1–100                     | Prevents zero-result requests and memory abuse    |

### Error responses

All errors return a consistent `{ "error": "message" }` shape. This lets consumers parse errors programmatically without guessing the format.

### Global error handler

A catch-all middleware in `app.js` returns `500 Internal Server Error` for any unhandled exception, preventing the server from crashing on unexpected errors.

## 7. Important Edge Cases

| Edge Case | How It's Handled |
|-----------|-----------------|
| **Exactly at deadline** | `currentTime > responseDueAt` uses strict inequality — a ticket at its exact deadline is **not** overdue |
| **One millisecond past deadline** | Correctly detected as overdue due to millisecond-precision comparison |
| **Empty ticket list** | Returns `{ tickets: [], total: 0, totalPages: 1 }` — valid structure, no crash |
| **Page beyond available data** | Returns empty tickets array with correct `total` — no error |
| **Same priority, same deadline** | Tie broken by earlier `createdAt` — deterministic ordering |
| **Case-insensitive filtering** | Both `customerName` and `assignedTo` filters use `.toLowerCase()` comparison |
| **Unassigned tickets** | Excluded from `assignedTo` filter results — `null` doesn't match any name |
| **Large ticket lists** | Pagination caps response size; `limit` capped at 100 to prevent oversized responses |
| **Overdue not stored** | Computed dynamically — queue is always accurate regardless of when it's queried |
| **Non-existent ticket ID** | Returns `404` — not silently ignored |

## 8. Time & Space Complexity

### Create ticket — `POST /tickets`

- **Time:** O(1) — array push, UUID generation, date arithmetic
- **Space:** O(1) per ticket (stored in memory)

### Get tickets — `GET /tickets`

Let `n` = total tickets in the store, `m` = tickets after filtering:

- **Filtering:** O(n) — single pass over all tickets
- **Sorting:** O(m log m) — JavaScript's `Array.sort()` (TimSort)
- **Pagination:** O(1) — array slice with computed indices
- **Overall:** O(n + m log m) per request

### Get ticket by ID — `GET /tickets/:id`

- **Time:** O(n) — linear scan (acceptable for in-memory store; a Map would give O(1) but adds complexity)

### Assign ticket — `PATCH /tickets/:id/assign`

- **Time:** O(n) — find by ID, then O(1) mutation

### Space (total)

- O(n) for `n` tickets stored in the array
- Sorting creates a shallow copy: O(m) additional space per request (garbage collected after response)

### Scaling note

For the assessment scope (hundreds to low thousands of tickets), these complexities are entirely acceptable. If scaling to millions of tickets were required, the in-memory array would be replaced with a database, the linear ID lookup with an indexed query, and the sort-on-read with a materialized priority queue or indexed view.

## 9. Testing Strategy

### Framework choice

**Jest** — zero-config test runner, built-in assertions, widely used in the Node.js ecosystem.

**Supertest** — sends HTTP requests to the Express app without starting a real server, enabling fast integration tests.

### Test structure

Tests are organized by feature area, matching the implementation priority:

1. **Ticket creation** — valid input produces correct output with all fields
2. **Deadline calculation** — urgent = +2h, normal = +24h (verified to the millisecond)
3. **Input validation** — every invalid scenario returns 400
4. **Overdue detection** — unit tests on `isOverdue()` covering before/at/after deadline
5. **Queue sorting** — unit tests on `sortQueue()` covering every ordering tier and ties
6. **API integration** — end-to-end tests through HTTP for queue order, filtering, pagination
7. **Assignment** — assign, reassign, unassign, not-found
8. **Filtering** — customer name, assignee, case-insensitive, empty results
9. **Pagination** — defaults, custom limits, beyond-last-page, metadata accuracy
10. **Edge cases** — large lists, arbitrary employee names, timestamp format

### Testing approach

- **Unit tests** for pure functions (`isOverdue`, `sortQueue`) — fast, isolated, cover boundary conditions
- **Integration tests** for API endpoints — verify the full request/response cycle including validation, service logic, and HTTP status codes
- **Time manipulation** — `sortQueue()` and `getTickets()` accept an optional `now` parameter, allowing tests to simulate future timestamps without mocking `Date`
- **Isolated state** — `clearAll()` resets the in-memory store before each test, preventing test interdependence

### Coverage

66 tests across 17 test suites covering all 20 specified edge cases, every validation rule, every endpoint, and every query parameter combination.
