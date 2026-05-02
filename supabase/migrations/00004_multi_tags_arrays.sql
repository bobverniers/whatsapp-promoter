-- external_groups: single tag -> tags array
ALTER TABLE external_groups ADD COLUMN tags TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE external_groups
SET tags = CASE
  WHEN tag IS NOT NULL AND btrim(tag) <> '' THEN ARRAY[btrim(tag)]
  ELSE ARRAY[]::TEXT[]
END;
DROP INDEX IF EXISTS idx_external_groups_tag;
ALTER TABLE external_groups DROP COLUMN tag;
ALTER TABLE external_groups ALTER COLUMN tags SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE external_groups ALTER COLUMN tags SET NOT NULL;
CREATE INDEX idx_external_groups_tags ON external_groups USING GIN (tags);

-- promo_templates: single tag -> tags array
ALTER TABLE promo_templates ADD COLUMN tags TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE promo_templates
SET tags = CASE
  WHEN tag IS NOT NULL AND btrim(tag) <> '' THEN ARRAY[btrim(tag)]
  ELSE ARRAY[]::TEXT[]
END;
DROP INDEX IF EXISTS idx_promo_templates_tag;
ALTER TABLE promo_templates DROP COLUMN tag;
ALTER TABLE promo_templates ALTER COLUMN tags SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE promo_templates ALTER COLUMN tags SET NOT NULL;
CREATE INDEX idx_promo_templates_tags ON promo_templates USING GIN (tags);
