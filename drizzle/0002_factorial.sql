CREATE TABLE study_sessions (
  session_id TEXT PRIMARY KEY,
  browser_key_hash TEXT NOT NULL UNIQUE,
  participant_id TEXT NOT NULL UNIQUE,
  experiment_version TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('preview','participant')),
  arm TEXT NOT NULL,
  focal_quality TEXT NOT NULL CHECK (focal_quality IN ('high','low')),
  retarget INTEGER NOT NULL CHECK (retarget IN (0,1)),
  initial_order TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('booked','explicit_exit')),
  closed_at TEXT,
  final_list_id TEXT,
  final_instance_id TEXT,
  final_hotel_id TEXT,
  final_action_id TEXT
);
--> statement-breakpoint
CREATE TABLE study_lists (
  list_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions(session_id),
  previous_list_id TEXT REFERENCES study_lists(list_id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  query_json TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX study_lists_by_session ON study_lists(session_id,created_at);
--> statement-breakpoint
CREATE TABLE study_list_entries (
  list_id TEXT NOT NULL REFERENCES study_lists(list_id),
  listing_instance_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  default_rank INTEGER NOT NULL,
  actual_rank INTEGER NOT NULL,
  PRIMARY KEY(list_id,listing_instance_id),
  UNIQUE(list_id,actual_rank)
);
--> statement-breakpoint
CREATE TABLE study_events (
  session_id TEXT NOT NULL REFERENCES study_sessions(session_id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_view_id TEXT,
  tab_id TEXT,
  event_seq INTEGER,
  client_at TEXT,
  received_at TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  page TEXT NOT NULL,
  action TEXT,
  source TEXT,
  list_id TEXT REFERENCES study_lists(list_id),
  listing_instance_id TEXT,
  hotel_id TEXT,
  default_rank INTEGER,
  actual_rank INTEGER,
  duration_ms INTEGER,
  visible_fraction REAL,
  scroll_percent INTEGER,
  PRIMARY KEY(session_id,event_id)
);
--> statement-breakpoint
CREATE INDEX study_events_by_session ON study_events(session_id,occurred_at);
--> statement-breakpoint
CREATE INDEX study_events_by_rank ON study_events(session_id,event_type,default_rank,occurred_at);
--> statement-breakpoint
CREATE VIEW study_session_metrics AS
WITH observed AS (
  SELECT s.session_id,s.participant_id,s.experiment_version,s.consent_version,s.run_type,s.arm,s.focal_quality,s.retarget,
    s.consented_at,s.last_active_at,s.outcome,s.closed_at,s.final_list_id,s.final_instance_id,s.final_hotel_id,
    initial.list_id AS initial_list_id,
    focal.hotel_id AS focal_hotel_id,
    critical.hotel_id AS planned_critical_hotel_id,
    CASE WHEN s.outcome='booked' THEN CAST(s.final_hotel_id=focal.hotel_id AS INTEGER) END AS booked_focal,
    (SELECT MIN(e.occurred_at) FROM study_events e WHERE e.session_id=s.session_id AND e.event_type='viewport_enter' AND e.default_rank=7) AS critical_reached_at,
    (SELECT MIN(e.occurred_at) FROM study_events e WHERE e.session_id=s.session_id AND e.event_type='card_impression' AND e.default_rank=7) AS critical_exposed_at,
    (SELECT MIN(e.occurred_at) FROM study_events e WHERE e.session_id=s.session_id AND e.event_type='card_impression' AND e.default_rank=1) AS focal_exposed_at
  FROM study_sessions s
  JOIN study_lists initial ON initial.session_id=s.session_id AND initial.reason='initial'
  JOIN study_list_entries focal ON focal.list_id=initial.list_id AND focal.default_rank=1
  JOIN study_list_entries critical ON critical.list_id=initial.list_id AND critical.default_rank=7
), choices AS (
  SELECT o.*,
    (SELECT e.event_id FROM study_events e
     WHERE e.session_id=o.session_id AND e.occurred_at>=o.critical_exposed_at
       AND (e.event_type IN ('hotel_open','room_select','booking_enter','booking_confirm','explicit_exit')
         OR (e.event_type='card_impression' AND e.default_rank>7 AND NOT EXISTS (
            SELECT 1 FROM study_events p WHERE p.session_id=e.session_id AND p.hotel_id=e.hotel_id AND p.event_type='card_impression'
              AND (p.occurred_at<e.occurred_at OR (p.occurred_at=e.occurred_at AND p.rowid<e.rowid)))))
     ORDER BY e.occurred_at,e.rowid LIMIT 1) AS first_after_critical_event_id,
    CASE WHEN o.critical_exposed_at IS NOT NULL THEN EXISTS(
      SELECT 1 FROM study_events e WHERE e.session_id=o.session_id AND e.event_type='card_impression' AND e.default_rank>7 AND e.occurred_at>=o.critical_exposed_at
      AND NOT EXISTS (SELECT 1 FROM study_events p WHERE p.session_id=e.session_id AND p.hotel_id=e.hotel_id AND p.event_type='card_impression'
        AND (p.occurred_at<e.occurred_at OR (p.occurred_at=e.occurred_at AND p.rowid<e.rowid)))
    ) END AS continued_to_new
  FROM observed o
)
SELECT c.*, e.event_type AS first_after_critical, e.hotel_id AS first_after_critical_hotel_id,
 e.actual_rank AS first_after_critical_actual_rank, e.occurred_at AS first_after_critical_at
FROM choices c LEFT JOIN study_events e ON e.session_id=c.session_id AND e.event_id=c.first_after_critical_event_id;
