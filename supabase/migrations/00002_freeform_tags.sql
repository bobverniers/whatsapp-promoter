-- Drop foreign key constraints so tags become freeform
ALTER TABLE external_groups DROP CONSTRAINT IF EXISTS external_groups_location_tag_fkey;
ALTER TABLE promo_templates DROP CONSTRAINT IF EXISTS promo_templates_location_tag_fkey;

-- Rename location_tag -> tag on all three tables
ALTER TABLE community_links RENAME COLUMN location_tag TO tag;
ALTER TABLE external_groups RENAME COLUMN location_tag TO tag;
ALTER TABLE promo_templates RENAME COLUMN location_tag TO tag;

-- Recreate indexes with new column name
DROP INDEX IF EXISTS idx_external_groups_location;
DROP INDEX IF EXISTS idx_promo_templates_location;
CREATE INDEX idx_external_groups_tag ON external_groups(tag);
CREATE INDEX idx_promo_templates_tag ON promo_templates(tag);
