-- Create the desks table
CREATE TABLE IF NOT EXISTS desks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create the desk_assignments table
CREATE TABLE IF NOT EXISTS desk_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  desk_id INTEGER NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Add desk_id column to tickets table
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS desk_id INTEGER REFERENCES desks(id);

-- Create a default desk (postmaster)
INSERT INTO desks (name, email, description, is_default)
VALUES ('Default', 'postmaster', 'Default desk for all incoming emails', TRUE)
ON CONFLICT (email) DO NOTHING;

-- Assign all admin users to the default desk
INSERT INTO desk_assignments (user_id, desk_id)
SELECT u.id, d.id
FROM users u, desks d
WHERE u.role = 'admin' AND d.is_default = TRUE
ON CONFLICT DO NOTHING;

-- Update existing tickets to use the default desk
UPDATE tickets 
SET desk_id = (SELECT id FROM desks WHERE is_default = TRUE)
WHERE desk_id IS NULL;
