CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  protocol TEXT NOT NULL,
  version TEXT NOT NULL,
  run_type TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  layout TEXT NOT NULL,
  arm TEXT,
  assigned_at TEXT,
  released INTEGER NOT NULL,
  critical_choice TEXT,
  critical_choice_at TEXT,
  critical_choice_slot INTEGER,
  critical_source TEXT,
  survey_pending INTEGER NOT NULL DEFAULT 0,
  beliefs TEXT,
  recognition TEXT,
  outcome TEXT,
  chosen_hotel TEXT,
  chosen_slot INTEGER,
  chosen_source TEXT,
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  finished_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  last_command TEXT
);
--> statement-breakpoint
CREATE TABLE events (
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  client_at TEXT,
  client_seq INTEGER,
  page_id TEXT,
  slot INTEGER,
  hotel_id TEXT,
  surface TEXT,
  control TEXT,
  duration_ms INTEGER,
  progress INTEGER,
  last_released INTEGER,
  PRIMARY KEY(session_id, event_id)
);
--> statement-breakpoint
CREATE INDEX events_session_time ON events(session_id,received_at);
--> statement-breakpoint
CREATE INDEX sessions_protocol_arm ON sessions(protocol,arm);
