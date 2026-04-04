// TODO: implement in M1-06
// Route handlers for the Hub HTTP API and WebSocket endpoints.
//
// Planned routes:
//
//  GET    /api/systems                  — list all registered systems
//  GET    /api/systems/:id              — get system by id
//  GET    /api/systems/:id/metrics      — get latest metrics for system
//  GET    /api/systems/:id/metrics/history — paginated metrics history
//
//  GET    /api/alerts                   — list all alerts
//  GET    /api/alerts/:id               — get alert by id
//  POST   /api/alerts/:id/acknowledge   — acknowledge an alert
//
//  GET    /api/alert-rules              — list all alert rules
//  POST   /api/alert-rules              — create an alert rule
//  PUT    /api/alert-rules/:id          — update an alert rule
//  DELETE /api/alert-rules/:id          — delete an alert rule
//
//  WS     /ws/agent                     — agent connection endpoint
//  WS     /ws/dashboard/:systemId       — real-time metrics for the web UI
//  WS     /ws/terminal/:sessionId       — interactive terminal (M6)

export {}
