ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS template_rotation_cursor INT NOT NULL DEFAULT 0;
