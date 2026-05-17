ALTER TABLE automation_configs
ADD COLUMN IF NOT EXISTS group_rotation_order UUID[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS template_rotation_order UUID[] NOT NULL DEFAULT '{}';
