CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Community invite links
CREATE TABLE community_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tag TEXT UNIQUE NOT NULL,
  current_url TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- External WhatsApp groups to promote in
CREATE TABLE external_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whapi_id TEXT UNIQUE NOT NULL,
  name TEXT,
  tag TEXT,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_promoted_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  status_notes TEXT
);

-- Message templates with {{link}} placeholder
CREATE TABLE promo_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL,
  tag TEXT,
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_external_groups_tag ON external_groups(tag);
CREATE INDEX idx_external_groups_active ON external_groups(is_active);
CREATE INDEX idx_promo_templates_tag ON promo_templates(tag);
