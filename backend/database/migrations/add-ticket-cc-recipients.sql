-- Add cc_recipients column to tickets table
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS cc_recipients JSONB DEFAULT '[]'::"jsonb";