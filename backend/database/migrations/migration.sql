-- Add attachments column to messages table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'messages' AND column_name = 'attachments'
    ) THEN
        ALTER TABLE messages ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE 'Added attachments column to messages table';
    ELSE
        RAISE NOTICE 'Attachments column already exists in messages table';
    END IF;
END $$;