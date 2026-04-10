# Project Plan: Automated WhatsApp Community Promoter

## 1. Overview
A "Human-like" automation system to manage community growth. The system scans external WhatsApp groups (via Whapi), stores them in Supabase, and drips promotional messages to them based on location-based categories (Amsterdam vs. Utrecht) and strict "warm-up" and "cooldown" rules.

## 2. Tech Stack
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (Existing)
- **API Gateway:** Whapi.cloud (for WhatsApp interaction)
- **Runtime:** Node.js (Next.js API routes or Edge Functions)
- **UI:** Next.js (Admin Dashboard for link/template management)

## 3. Database Schema (Supabase)
Please create the following tables with these specific constraints:

```sql
-- Dynamic links for injection
CREATE TABLE community_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_tag TEXT UNIQUE NOT NULL, -- e.g., 'AMS', 'UTR'
  current_url TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- External groups to promote in
CREATE TABLE external_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  whapi_id TEXT UNIQUE NOT NULL, -- WhatsApp Group ID
  name TEXT,
  location_tag TEXT REFERENCES community_links(location_tag),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), 
  last_promoted_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  status_notes TEXT
);

-- Message templates with placeholders
CREATE TABLE promo_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content TEXT NOT NULL, -- e.g., "Hi! If you need housing in AMS: {{link}}"
  location_tag TEXT REFERENCES community_links(location_tag),
  use_count INT DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE
);
```

## 4. Core Logic & Constraints
The automation must follow these "Human-Behavior" rules:

1.  **Warm-up Rule:** A group must have `joined_at` > 3 days ago before receiving its first message.
2.  **Cooldown Rule:** A group can only be messaged once every 14 days (`last_promoted_at` < NOW - 14 days).
3.  **Rotation Rule:** For a given `location_tag`, pick the template with the lowest `use_count` or oldest `last_used_at`.
4.  **Injection:** Replace `{{link}}` in the template with the `current_url` from `community_links` for that category.
5.  **Failure Handling:** If Whapi returns an error (403 Forbidden/Kicked), set `is_active = FALSE`, log the error, and trigger a notification (Webhook).

## 5. Implementation Phases (Steps for Cursor)

### Phase 1: The "Sync" Engine
Create a script/API route that:
- Calls `GET https://gate.whapi.cloud/groups` (using `WHAPI_TOKEN`).
- Upserts groups into `external_groups`. 
- **Crucial:** Only insert if they don't exist; don't overwrite `joined_at` or `last_promoted_at`.

### Phase 2: The "Promotion" Worker
Create a function that:
- Finds **one** eligible group from `external_groups` matching all constraints (Warm-up, Cooldown, Active).
- Fetches the correct `community_link` and `promo_template`.
- Sends the message via `POST https://gate.whapi.cloud/messages/text`.
- Updates `last_promoted_at` and `use_count`.

### Phase 3: Simple Admin UI (Next.js)
Build a single-page dashboard to:
- **Group Management:** A table to assign `location_tag` (AMS/UTR) to newly synced groups.
- **Link Management:** Update the `current_url` for each location.
- **Template CRUD:** Add/Edit the 4-5 "human-sounding" messages.

## 6. Security & Safety
- **Environment Variables:** Store `WHAPI_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` securely.
- **Rate Limiting:** Ensure the worker never sends more than 1 message per hour to stay under the radar.

---

