-- Mind Whiteboard — Finanzen, Stufe 1: das Datenmodell und die Regel-Engine.
--
-- Follows the pattern documented in 0001_foundation for every table: own id,
-- owner, timestamps, indexes, RLS, grants, updated_at trigger.
--
-- THE ONE INVARIANT THIS SCHEMA EXISTS FOR: an imported booking keeps its
-- original text and its original amount forever. `raw_description`,
-- `amount_minor`, `currency`, `booking_date` and `value_date` are written once,
-- by the import, and never again. Everything the app *thinks* about a booking —
-- which merchant it is, which category it belongs to, whether it counts in the
-- analytics — lives in separate, nullable columns (and, when the user decided
-- it by hand, in a separate table). An interpretation that turns out wrong is
-- re-computed; the fact behind it is never rewritten.
--
-- MONEY IS AN INTEGER. `amount_minor bigint` holds minor units: 24,83 € is
-- 2483. No float, no numeric-with-rounding-surprises, and the currency is
-- always stored next to it. EUR is the only currency in use today, which is
-- exactly why it is a column with an ISO-shape check and not an assumption
-- baked into the column types.
--
-- MERCHANT AND CATEGORY ARE TWO THINGS. `finance_merchants` (+ its patterns)
-- answers "who was this?"; `finance_category_rules` answers "what kind of
-- spending is that?". Keeping them apart is what lets EDEKA be one merchant
-- with two categories that depend on the amount, and what lets a merchant be
-- recognised without its category being decided.
--
-- WHERE THE MATCHING LIVES: not here. Normalisation, tokenisation, merchant
-- matching, category resolution and the backtest are pure functions in
-- src/lib/finance/ — deterministic, unit-tested, and the only place the rules
-- exist. This file stores the rules, enforces who may see them, and provides
-- the one operation that must not be split into several client writes
-- (`finance_learn_merchant_rule`, at the bottom).

-- ── A shared invariant for stored patterns ──────────────────────────────────
-- The tokens of a pattern are produced by src/lib/finance/normalize.js. The
-- database does not re-implement that normaliser — it checks the properties
-- the normaliser promises, so a hand-written INSERT cannot store a pattern the
-- matcher could never match: no nulls, nothing empty, no whitespace inside a
-- token (whitespace is a token boundary, never part of one), and upper case.
create or replace function public.finance_tokens_normalized(p_tokens text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tokens is not null
     and array_length(p_tokens, 1) >= 1
     and not exists (
       select 1 from unnest(p_tokens) as t(token)
       where token is null
          or token = ''
          or token <> upper(token)
          or token <> btrim(token)
          or token ~ '\s'
          or char_length(token) > 64
     );
$$;

-- ── Matching, as far as the database needs to do it itself ─────────────────
-- This is NOT a second implementation of the normaliser, and that is the whole
-- point. Turning a booking text into tokens is the Unicode-hairy half: NFKC,
-- case folding (Postgres' `upper('ß')` is 'ß', JavaScript's is 'SS'), and what
-- counts as a letter in a regex character class. Two implementations of that
-- would agree in testing and disagree on somebody's real bank statement, and a
-- matcher that is 99 % the same as the other one is worse than one matcher.
--
-- So tokenising happens exactly once, in src/lib/finance/normalize.js, and the
-- result is stored on the booking. What is left here is the part that is pure
-- array logic and trivially the same in both languages: does this pattern occur
-- in this list of tokens — as a whole token, or as a contiguous phrase in order.
-- That is what lets finance_learn_merchant_rule verify a client's claim instead
-- of believing it.
create or replace function public.finance_pattern_matches(
  p_pattern_type   text,
  p_pattern_tokens text[],
  p_tokens         text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_pattern_tokens is null or p_tokens is null then false
    when coalesce(array_length(p_pattern_tokens, 1), 0) = 0 then false
    -- A whole token, never a substring: 'REWE' is in
    -- {REWE,TROISDORF,SAGT,DANKE,8407} and not in {REWERT,UND,SOEHNE}.
    when p_pattern_type = 'exact_token' then
      array_length(p_pattern_tokens, 1) = 1 and p_pattern_tokens[1] = any (p_tokens)
    -- In this order and next to each other: {MAX,UND,MORITZ} occurs in
    -- {MAX,UND,MORITZ,TROISDORF} and not in {MAX,MORITZ} or {MORITZ,UND,MAX}.
    when p_pattern_type = 'exact_phrase' then
      array_length(p_pattern_tokens, 1) >= 2
      and exists (
        -- Anchored on the array's own lower bound rather than on 1: every array
        -- this schema stores is 1-based, and a slice that quietly assumed it
        -- would be a matching bug rather than an error if one ever is not.
        select 1
        from generate_series(
          coalesce(array_lower(p_tokens, 1), 1),
          coalesce(array_upper(p_tokens, 1), 0) - array_length(p_pattern_tokens, 1) + 1
        ) as s(i)
        where p_tokens[s.i : s.i + array_length(p_pattern_tokens, 1) - 1] = p_pattern_tokens
      )
    else false
  end;
$$;

-- ── finance_accounts: where a booking came from ─────────────────────────────
-- A source of transactions — "DKB Girokonto", "Bargeld". No bank connection and
-- no Open Banking: this is a label with a currency, and that is all Stufe 1
-- needs it to be.
create table if not exists public.finance_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  provider   text,
  -- ISO 4217, three letters. Checked for shape, not against a list: a new
  -- currency must not need a migration, and a typo must not become a row the
  -- analytics cannot add up.
  currency   text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_name_not_blank check (char_length(btrim(name)) > 0),
  constraint finance_accounts_name_len check (char_length(name) <= 120),
  constraint finance_accounts_provider_len check (provider is null or char_length(provider) <= 80),
  constraint finance_accounts_currency_iso check (currency ~ '^[A-Z]{3}$')
);

create index if not exists finance_accounts_user_id_idx on public.finance_accounts (user_id);

-- ── finance_categories: the MVP five, per account ───────────────────────────
-- `slug` is the stable technical key the rules and the code refer to; `label`
-- is what a human reads and may be renamed without breaking anything.
--
-- The five slugs are the decided MVP set (src/config/finance.js holds the same
-- five). The old Excel tracker also carried an "Events" label — deliberately
-- NOT carried over: it is not one of the agreed categories, and inventing it
-- here would make it real.
create table if not exists public.finance_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  slug       text not null,
  label      text not null,
  sort_order integer not null default 0,
  -- true for the five seeded categories. A later screen can refuse to delete
  -- one instead of leaving rules pointing nowhere.
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_categories_slug_shape check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint finance_categories_label_not_blank check (char_length(btrim(label)) > 0),
  constraint finance_categories_label_len check (char_length(label) <= 60)
);

-- One slug per account: the slug is what a rule and the code name, so a second
-- row with the same slug would make "lebensmittel" ambiguous.
create unique index if not exists finance_categories_user_slug_idx
  on public.finance_categories (user_id, slug);
create index if not exists finance_categories_user_sort_idx
  on public.finance_categories (user_id, sort_order);

-- The MVP category set, in one place, used by both the signup trigger and the
-- backfill below — so the two can never drift apart.
create or replace function public.finance_default_categories()
returns table (slug text, label text, sort_order integer)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('lebensmittel', 'Lebensmittel', 10),
    ('restaurant',   'Restaurant',   20),
    ('klamotten',    'Klamotten',    30),
    ('drogerie',     'Drogerie',     40),
    ('sonstige',     'Sonstige',     50)
  ) as c(slug, label, sort_order);
$$;

-- Seeded with the account, like the profile in 0001. `security definer`
-- for the same reason: the trigger runs inside the signup transaction, which
-- is not the new user yet.
create or replace function public.finance_seed_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.finance_categories (user_id, slug, label, sort_order, is_system)
  select new.id, d.slug, d.label, d.sort_order, true
  from public.finance_default_categories() d
  on conflict (user_id, slug) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_finance on auth.users;
create trigger on_auth_user_created_finance
  after insert on auth.users
  for each row execute function public.finance_seed_categories();

-- ── finance_merchants: who a booking was with ───────────────────────────────
-- Created by the user, never guessed from a booking text. `review_mode` says
-- how much the automatic category resolution may decide on its own:
--   'auto'          — an unambiguous rule result is applied
--   'conditional'   — only an amount rule that actually matched is applied;
--                     falling back to the merchant's default rule asks the user
--   'always_review' — the merchant is recognised, the category never decided
create table if not exists public.finance_merchants (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  canonical_name text not null,
  review_mode    text not null default 'auto',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint finance_merchants_name_not_blank check (char_length(btrim(canonical_name)) > 0),
  constraint finance_merchants_name_len check (char_length(canonical_name) <= 120),
  constraint finance_merchants_review_mode_known
    check (review_mode in ('auto', 'conditional', 'always_review'))
);

-- Two merchants that differ only in case or padding are one merchant with a
-- typo — and two sets of rules nobody can keep in sync.
create unique index if not exists finance_merchants_user_name_idx
  on public.finance_merchants (user_id, lower(btrim(canonical_name)));

-- ── finance_merchant_patterns: how a merchant is recognised ─────────────────
-- `tokens` is the normalised representation and the thing the matcher compares
-- against — one array, in order, produced by src/lib/finance/normalize.js. It is
-- deliberately not mirrored into a second text column: two representations of
-- the same pattern is one of them waiting to be wrong.
--
--   exact_token  — exactly one token, and it must appear as a WHOLE token:
--                  'REWE' matches 'REWE TROISDORF SAGT DANKE 8407' and never
--                  'REWERT'. Word boundaries come from the tokenizer, not from
--                  a substring search.
--   exact_phrase — two or more tokens, in that order and next to each other:
--                  ['MAX','UND','MORITZ'] matches 'MAX UND MORITZ TROISDORF',
--                  not 'MAX MORITZ' and not 'MORITZ UND MAX'.
create table if not exists public.finance_merchant_patterns (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  merchant_id  uuid not null references public.finance_merchants (id) on delete cascade,
  pattern_type text not null,
  tokens       text[] not null,
  -- Deactivated rather than deleted: a pattern that once assigned hundreds of
  -- bookings is history worth keeping, and the unique index below only guards
  -- the active ones.
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint finance_merchant_patterns_type_known
    check (pattern_type in ('exact_token', 'exact_phrase')),
  constraint finance_merchant_patterns_tokens_normalized
    check (public.finance_tokens_normalized(tokens)),
  constraint finance_merchant_patterns_token_arity
    check (pattern_type <> 'exact_token' or array_length(tokens, 1) = 1),
  constraint finance_merchant_patterns_phrase_arity
    check (pattern_type <> 'exact_phrase' or array_length(tokens, 1) >= 2)
);

-- ONE ACTIVE PATTERN BELONGS TO ONE MERCHANT, per account. The same active
-- pattern under two merchants is not a duplicate to tolerate — it is a booking
-- set that would be `conflict` forever, with no way for the user to resolve it
-- except by deleting one of the two. Refused at the source.
--
-- This does NOT stand in the way of aliases, which is the case worth checking:
-- a merchant may have as many patterns as it needs ('REWE', 'REWE MARKT',
-- 'REWE CITY'), and two different merchants may have patterns that both match
-- the same booking as long as the patterns themselves differ ('REWE' vs.
-- 'REWE TO GO'). That booking is then a conflict — deliberately, because
-- nothing in the product says which of the two should win, and inventing a
-- specificity rule is exactly the guess this module refuses to make. The user
-- resolves it by overriding that booking or by retiring a pattern.
create unique index if not exists finance_merchant_patterns_unique_idx
  on public.finance_merchant_patterns (user_id, pattern_type, tokens)
  where active;
-- The matcher reads every active pattern of one account in one go.
create index if not exists finance_merchant_patterns_user_active_idx
  on public.finance_merchant_patterns (user_id, active);
create index if not exists finance_merchant_patterns_merchant_idx
  on public.finance_merchant_patterns (merchant_id);

-- ── finance_category_rules: which category a merchant means ─────────────────
-- A rule belongs to a merchant and may carry an amount range. Both ends are
-- optional and each has its own inclusivity, which is what makes the EDEKA case
-- expressible without an off-by-one:
--
--   max_amount_minor = 1200, max_inclusive = true   → 12,00 € still Restaurant
--   min_amount_minor = 1200, min_inclusive = false  → 12,01 € Lebensmittel
--
-- A rule with neither end is the merchant's DEFAULT RULE ("REWE is always
-- Lebensmittel"). The resolver checks amount rules first and falls back to the
-- default — and reports a conflict rather than picking a winner when two
-- matching rules disagree.
create table if not exists public.finance_category_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  merchant_id      uuid not null references public.finance_merchants (id) on delete cascade,
  category_id      uuid not null references public.finance_categories (id) on delete cascade,
  min_amount_minor bigint,
  min_inclusive    boolean not null default true,
  max_amount_minor bigint,
  max_inclusive    boolean not null default true,
  -- Which currency the bounds are counted in. An amount bound without one is a
  -- number without a unit, so the check below demands it as soon as there is a
  -- bound at all. Null on a default rule: it applies whatever was paid.
  currency         text,
  active           boolean not null default true,
  -- The identity of a rule's condition, as one comparable value, stamped by the
  -- trigger below. Postgres treats NULLs in a unique index as distinct, so
  -- "one default rule per merchant, one rule per condition" cannot be expressed
  -- over the four nullable columns themselves; a generated column cannot do it
  -- either, because the expression would have to be immutable. The trigger
  -- overwrites the column on every write, so it cannot drift from the bounds.
  bounds_key       text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint finance_category_rules_bounds_order check (
    min_amount_minor is null or max_amount_minor is null
    or min_amount_minor <= max_amount_minor
  ),
  -- Bounds are compared against the size of a booking, never its sign, so a
  -- negative bound could not match anything.
  constraint finance_category_rules_bounds_not_negative check (
    (min_amount_minor is null or min_amount_minor >= 0)
    and (max_amount_minor is null or max_amount_minor >= 0)
  ),
  constraint finance_category_rules_currency_iso check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint finance_category_rules_bounds_need_currency check (
    (min_amount_minor is null and max_amount_minor is null) or currency is not null
  ),
  -- A bound the client cannot read back exactly would compare against a
  -- rounded number. Same reason as finance_transactions_amount_exact.
  constraint finance_category_rules_bounds_exact check (
    (min_amount_minor is null or min_amount_minor <= 9007199254740991)
    and (max_amount_minor is null or max_amount_minor <= 9007199254740991)
  )
);

-- One rule per merchant and condition. Two active rules with identical bounds
-- would be a coin flip the resolver refuses to make.
create unique index if not exists finance_category_rules_unique_idx
  on public.finance_category_rules (user_id, merchant_id, bounds_key)
  where active;
create index if not exists finance_category_rules_merchant_idx
  on public.finance_category_rules (user_id, merchant_id)
  where active;
create index if not exists finance_category_rules_category_idx
  on public.finance_category_rules (category_id);

-- Runs as the caller, like set_updated_at: stamping a column from the row being
-- written needs no elevated rights.
create or replace function public.finance_stamp_bounds_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.bounds_key :=
    coalesce(new.min_amount_minor::text, '*') || '/' || new.min_inclusive::text || '/' ||
    coalesce(new.max_amount_minor::text, '*') || '/' || new.max_inclusive::text || '/' ||
    coalesce(new.currency, '*');
  return new;
end;
$$;

drop trigger if exists finance_category_rules_bounds_key on public.finance_category_rules;
create trigger finance_category_rules_bounds_key
  before insert or update on public.finance_category_rules
  for each row execute function public.finance_stamp_bounds_key();

-- ── finance_imports: what a later parser will record about a file ───────────
-- Metadata only. No PDF is stored, and no parser exists yet — this is the row a
-- parser will hang its result off, plus the two things a re-import has to know:
-- which file it was (`source_hash`) and which parser read it.
create table if not exists public.finance_imports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  account_id     uuid not null references public.finance_accounts (id) on delete cascade,
  source_type    text not null default 'manual',
  source_name    text,
  source_hash    text,
  status         text not null default 'pending',
  parser_version text,
  parser_notes   text,
  imported_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint finance_imports_source_type_known check (source_type in ('manual', 'pdf', 'csv')),
  constraint finance_imports_status_known
    check (status in ('pending', 'parsed', 'imported', 'failed')),
  constraint finance_imports_source_name_len check (source_name is null or char_length(source_name) <= 255),
  constraint finance_imports_source_hash_len check (source_hash is null or char_length(source_hash) <= 128),
  constraint finance_imports_parser_version_len check (parser_version is null or char_length(parser_version) <= 40)
);

create index if not exists finance_imports_user_created_idx
  on public.finance_imports (user_id, created_at desc);
create index if not exists finance_imports_account_idx on public.finance_imports (account_id);
-- The same file twice is the most likely import accident there is.
create unique index if not exists finance_imports_source_hash_idx
  on public.finance_imports (user_id, source_hash)
  where source_hash is not null;

-- ── finance_transactions: the booking, and what we think about it ───────────
-- Read the column list as two halves. Everything down to `external_reference`
-- is the fact as it arrived and is never rewritten. Everything after it is
-- interpretation: nullable, re-computable, and never a reason to touch the
-- half above.
create table if not exists public.finance_transactions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  account_id           uuid not null references public.finance_accounts (id) on delete cascade,
  -- The booking outlives the import record: deleting the import metadata must
  -- not delete the money.
  import_id            uuid references public.finance_imports (id) on delete set null,
  booking_date         date not null,
  value_date           date,
  -- Minor units. Negative is money out, positive is money in — as the bank
  -- reports it. Rules compare the size, never the sign (see the resolver).
  --
  -- bigint, bounded to ±(2^53 − 1). PostgREST serialises int8 as a JSON
  -- *number*, and JavaScript reads that as a float64 — 9007199254740993 comes
  -- back as …992, silently. The column keeps bigint's headroom for the day a
  -- currency with more minor units or a different meaning shows up, and the
  -- constraint guarantees that everything actually stored is exactly
  -- representable in the client that has to read it. 90 billion euros of
  -- headroom for a personal account is not a limitation.
  amount_minor         bigint not null,
  currency             text not null default 'EUR',
  raw_description      text not null,
  external_reference   text,
  -- Derived from raw_description, deterministically, by the one normaliser —
  -- see the constraint below for why the database keeps a copy at all.
  normalized_tokens    text[] not null default '{}',
  -- ── interpretation from here on ──
  merchant_id          uuid references public.finance_merchants (id) on delete set null,
  category_id          uuid references public.finance_categories (id) on delete set null,
  transaction_type     text not null default 'purchase',
  -- A Retoure is its own booking, never a correction of the original one. This
  -- is the link back; the original keeps its amount, whatever gets refunded.
  refunds_transaction_id uuid references public.finance_transactions (id) on delete set null,
  include_in_analytics boolean not null default true,
  -- "Ich habe das von Hand entschieden." A later re-evaluation steps over this
  -- row instead of overwriting it — enforced in finance_learn_merchant_rule,
  -- not only in the client.
  manual_lock          boolean not null default false,
  -- Dedupe material for a later importer: whatever the parser can compute from
  -- one line (date + amount + text + reference). Unique per account when set;
  -- the final DKB rule is deliberately not invented here, because no real
  -- statement has been read yet.
  dedupe_hash          text,
  -- What the parser saw: page, line, the bank's own booking key. Diagnostics,
  -- never a place for a second copy of the amount.
  source_metadata      jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint finance_transactions_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint finance_transactions_raw_len check (char_length(raw_description) <= 2000),
  constraint finance_transactions_reference_len
    check (external_reference is null or char_length(external_reference) <= 255),
  constraint finance_transactions_dedupe_len
    check (dedupe_hash is null or char_length(dedupe_hash) <= 128),
  constraint finance_transactions_type_known check (
    transaction_type in ('purchase', 'refund', 'transfer', 'income', 'fee', 'other')
  ),
  constraint finance_transactions_refund_link
    check (refunds_transaction_id is null or transaction_type = 'refund'),
  constraint finance_transactions_refund_not_self
    check (refunds_transaction_id is null or refunds_transaction_id <> id),
  -- See the comment on amount_minor: what the database accepts, the client can
  -- read back exactly. 9007199254740991 = Number.MAX_SAFE_INTEGER.
  constraint finance_transactions_amount_exact
    check (amount_minor between -9007199254740991 and 9007199254740991),
  -- The tokens of raw_description, produced once by the one normaliser
  -- (src/lib/finance/normalize.js) when the booking is created. They are part
  -- of the raw half: derived from it, frozen with it, and never rewritten.
  --
  -- They exist so the DATABASE can check a match instead of believing a client:
  -- finance_learn_merchant_rule verifies every booking it is asked to re-label
  -- against these tokens (see finance_pattern_matches). An empty array is the
  -- safe default — it matches nothing, so a booking that arrived without
  -- tokens stays unresolved instead of being swept up by the next pattern.
  constraint finance_transactions_tokens_normalized check (
    array_length(normalized_tokens, 1) is null
    or public.finance_tokens_normalized(normalized_tokens)
  )
);

-- For a database that already ran an earlier copy of this file: the column and
-- its constraint are added the way 0005 adds the Google columns to `events`.
-- `create table if not exists` above does nothing to an existing table.
alter table public.finance_transactions
  add column if not exists normalized_tokens text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'finance_transactions_amount_exact'
  ) then
    alter table public.finance_transactions add constraint finance_transactions_amount_exact
      check (amount_minor between -9007199254740991 and 9007199254740991);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'finance_transactions_tokens_normalized'
  ) then
    alter table public.finance_transactions add constraint finance_transactions_tokens_normalized
      check (
        array_length(normalized_tokens, 1) is null
        or public.finance_tokens_normalized(normalized_tokens)
      );
  end if;
end
$$;

-- The list every finance screen will ask for: one account's bookings, newest
-- first, with created_at breaking ties inside a day.
create index if not exists finance_transactions_user_date_idx
  on public.finance_transactions (user_id, booking_date desc, created_at desc);
-- Re-evaluating after a new pattern, and every "what did I spend at X" query.
create index if not exists finance_transactions_user_merchant_idx
  on public.finance_transactions (user_id, merchant_id);
-- The queue the learning flow works through: bookings nobody has recognised.
create index if not exists finance_transactions_unresolved_idx
  on public.finance_transactions (user_id, booking_date desc)
  where merchant_id is null;
create index if not exists finance_transactions_import_idx
  on public.finance_transactions (import_id);
-- The duplicate guard a later importer will lean on.
create unique index if not exists finance_transactions_dedupe_idx
  on public.finance_transactions (user_id, account_id, dedupe_hash)
  where dedupe_hash is not null;

-- ── The raw half is frozen, and not only by convention ──────────────────────
-- src/data/financeDefaults.js keeps these columns out of every patch a client
-- can send, which stops the accident. This stops the rest: no rule run, no
-- future importer and no hand-written UPDATE can rewrite what a booking said it
-- was. A booking that was imported wrongly is deleted and imported again —
-- there is no version of this app in which an amount quietly changes.
--
-- `account_id` and `import_id` are deliberately not frozen: which account a
-- booking was filed under is bookkeeping, not the fact itself.
create or replace function public.finance_freeze_raw_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_date       is distinct from old.booking_date
     or new.value_date      is distinct from old.value_date
     or new.amount_minor    is distinct from old.amount_minor
     or new.currency        is distinct from old.currency
     or new.raw_description is distinct from old.raw_description
     or new.external_reference is distinct from old.external_reference
     -- The tokens are a function of raw_description. Letting them change while
     -- the text stays put would be the one way to make a stored booking match a
     -- pattern it does not contain — exactly what the verification below rests
     -- on not happening.
     or new.normalized_tokens is distinct from old.normalized_tokens
  then
    raise exception 'finance: die Originaldaten einer Buchung sind unveraenderlich (id %)', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists finance_transactions_freeze_raw on public.finance_transactions;
create trigger finance_transactions_freeze_raw
  before update on public.finance_transactions
  for each row execute function public.finance_freeze_raw_booking();

-- ── finance_transaction_overrides: the decisions a human made by hand ───────
-- WHY A SEPARATE TABLE AND NOT MORE COLUMNS ON THE BOOKING
-- The columns on `finance_transactions` hold the *current* result of the
-- automatic resolution — they are re-computed whenever a rule changes. A
-- deliberate decision must survive exactly that. Keeping it in its own row
-- makes "manual beats automatic" a property of the data instead of a rule
-- somebody has to remember, keeps the decision when the automatic value is
-- recomputed, and leaves a place for the other things a user decides per
-- booking: excluding it from the analytics, correcting its type, a note.
--
-- `manual_lock` on the booking stays as the cheap guard every bulk UPDATE can
-- name in its WHERE clause; the override is the record of what was decided.
create table if not exists public.finance_transaction_overrides (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  transaction_id       uuid not null references public.finance_transactions (id) on delete cascade,
  merchant_id          uuid references public.finance_merchants (id) on delete set null,
  category_id          uuid references public.finance_categories (id) on delete set null,
  include_in_analytics boolean,
  transaction_type     text,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint finance_transaction_overrides_type_known check (
    transaction_type is null
    or transaction_type in ('purchase', 'refund', 'transfer', 'income', 'fee', 'other')
  ),
  constraint finance_transaction_overrides_note_len
    check (note is null or char_length(note) <= 500)
);

-- One decision per booking. A second row would be a second opinion nobody can
-- order.
create unique index if not exists finance_transaction_overrides_tx_idx
  on public.finance_transaction_overrides (transaction_id);
create index if not exists finance_transaction_overrides_user_idx
  on public.finance_transaction_overrides (user_id);

-- ── Ownership helpers for the policies below ────────────────────────────────
-- Every finance table carries `user_id`, so the four policies of 0001 would
-- already keep the rows apart. They would not stop one thing: a correctly-owned
-- row pointing at somebody else's parent — a pattern hung under a foreign
-- merchant, a booking parked in a foreign account. 0006_lists solved the same
-- problem with an `exists` sub-select inside the policy; with five referencing
-- columns on one table that becomes unreadable, so the sub-select is named
-- once here and called from the policies.
--
-- `stable`, invoker rights (never `security definer`): the lookup runs as the
-- caller, under the same RLS as everything else, which is exactly the question
-- being asked — "is this a row I may see?". Null passes, because a null
-- reference points at nothing.
create or replace function public.finance_owns_account(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_id is null or exists (
    select 1 from public.finance_accounts a
    where a.id = p_id and a.user_id = (select auth.uid())
  );
$$;

create or replace function public.finance_owns_import(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_id is null or exists (
    select 1 from public.finance_imports i
    where i.id = p_id and i.user_id = (select auth.uid())
  );
$$;

create or replace function public.finance_owns_merchant(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_id is null or exists (
    select 1 from public.finance_merchants m
    where m.id = p_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.finance_owns_category(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_id is null or exists (
    select 1 from public.finance_categories c
    where c.id = p_id and c.user_id = (select auth.uid())
  );
$$;

create or replace function public.finance_owns_transaction(p_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select p_id is null or exists (
    select 1 from public.finance_transactions t
    where t.id = p_id and t.user_id = (select auth.uid())
  );
$$;

-- ── RLS: the four policies, table by table ──────────────────────────────────
-- Finance data is the most personal data this app holds. Every table gets the
-- pattern from 0001 — select / insert / update / delete, each scoped to
-- `(select auth.uid()) = user_id` — plus, where a row references another
-- finance row, the ownership check on that reference. `using` decides which
-- rows may be touched, `with check` what a row may look like afterwards.

alter table public.finance_accounts enable row level security;

drop policy if exists "finance_accounts_select_own" on public.finance_accounts;
create policy "finance_accounts_select_own" on public.finance_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_accounts_insert_own" on public.finance_accounts;
create policy "finance_accounts_insert_own" on public.finance_accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "finance_accounts_update_own" on public.finance_accounts;
create policy "finance_accounts_update_own" on public.finance_accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "finance_accounts_delete_own" on public.finance_accounts;
create policy "finance_accounts_delete_own" on public.finance_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_categories enable row level security;

drop policy if exists "finance_categories_select_own" on public.finance_categories;
create policy "finance_categories_select_own" on public.finance_categories
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_categories_insert_own" on public.finance_categories;
create policy "finance_categories_insert_own" on public.finance_categories
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "finance_categories_update_own" on public.finance_categories;
create policy "finance_categories_update_own" on public.finance_categories
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "finance_categories_delete_own" on public.finance_categories;
create policy "finance_categories_delete_own" on public.finance_categories
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_merchants enable row level security;

drop policy if exists "finance_merchants_select_own" on public.finance_merchants;
create policy "finance_merchants_select_own" on public.finance_merchants
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_merchants_insert_own" on public.finance_merchants;
create policy "finance_merchants_insert_own" on public.finance_merchants
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "finance_merchants_update_own" on public.finance_merchants;
create policy "finance_merchants_update_own" on public.finance_merchants
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "finance_merchants_delete_own" on public.finance_merchants;
create policy "finance_merchants_delete_own" on public.finance_merchants
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_merchant_patterns enable row level security;

drop policy if exists "finance_merchant_patterns_select_own" on public.finance_merchant_patterns;
create policy "finance_merchant_patterns_select_own" on public.finance_merchant_patterns
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_merchant_patterns_insert_own" on public.finance_merchant_patterns;
create policy "finance_merchant_patterns_insert_own" on public.finance_merchant_patterns
  for insert to authenticated with check (
    (select auth.uid()) = user_id and public.finance_owns_merchant(merchant_id)
  );

drop policy if exists "finance_merchant_patterns_update_own" on public.finance_merchant_patterns;
create policy "finance_merchant_patterns_update_own" on public.finance_merchant_patterns
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and public.finance_owns_merchant(merchant_id)
  );

drop policy if exists "finance_merchant_patterns_delete_own" on public.finance_merchant_patterns;
create policy "finance_merchant_patterns_delete_own" on public.finance_merchant_patterns
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_category_rules enable row level security;

drop policy if exists "finance_category_rules_select_own" on public.finance_category_rules;
create policy "finance_category_rules_select_own" on public.finance_category_rules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_category_rules_insert_own" on public.finance_category_rules;
create policy "finance_category_rules_insert_own" on public.finance_category_rules
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
  );

drop policy if exists "finance_category_rules_update_own" on public.finance_category_rules;
create policy "finance_category_rules_update_own" on public.finance_category_rules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
  );

drop policy if exists "finance_category_rules_delete_own" on public.finance_category_rules;
create policy "finance_category_rules_delete_own" on public.finance_category_rules
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_imports enable row level security;

drop policy if exists "finance_imports_select_own" on public.finance_imports;
create policy "finance_imports_select_own" on public.finance_imports
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_imports_insert_own" on public.finance_imports;
create policy "finance_imports_insert_own" on public.finance_imports
  for insert to authenticated with check (
    (select auth.uid()) = user_id and public.finance_owns_account(account_id)
  );

drop policy if exists "finance_imports_update_own" on public.finance_imports;
create policy "finance_imports_update_own" on public.finance_imports
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and public.finance_owns_account(account_id)
  );

drop policy if exists "finance_imports_delete_own" on public.finance_imports;
create policy "finance_imports_delete_own" on public.finance_imports
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_transactions enable row level security;

drop policy if exists "finance_transactions_select_own" on public.finance_transactions;
create policy "finance_transactions_select_own" on public.finance_transactions
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_transactions_insert_own" on public.finance_transactions;
create policy "finance_transactions_insert_own" on public.finance_transactions
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_account(account_id)
    and public.finance_owns_import(import_id)
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
    and public.finance_owns_transaction(refunds_transaction_id)
  );

drop policy if exists "finance_transactions_update_own" on public.finance_transactions;
create policy "finance_transactions_update_own" on public.finance_transactions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.finance_owns_account(account_id)
    and public.finance_owns_import(import_id)
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
    and public.finance_owns_transaction(refunds_transaction_id)
  );

drop policy if exists "finance_transactions_delete_own" on public.finance_transactions;
create policy "finance_transactions_delete_own" on public.finance_transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

alter table public.finance_transaction_overrides enable row level security;

drop policy if exists "finance_transaction_overrides_select_own" on public.finance_transaction_overrides;
create policy "finance_transaction_overrides_select_own" on public.finance_transaction_overrides
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "finance_transaction_overrides_insert_own" on public.finance_transaction_overrides;
create policy "finance_transaction_overrides_insert_own" on public.finance_transaction_overrides
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and public.finance_owns_transaction(transaction_id)
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
  );

drop policy if exists "finance_transaction_overrides_update_own" on public.finance_transaction_overrides;
create policy "finance_transaction_overrides_update_own" on public.finance_transaction_overrides
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.finance_owns_transaction(transaction_id)
    and public.finance_owns_merchant(merchant_id)
    and public.finance_owns_category(category_id)
  );

drop policy if exists "finance_transaction_overrides_delete_own" on public.finance_transaction_overrides;
create policy "finance_transaction_overrides_delete_own" on public.finance_transaction_overrides
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- `anon` is the browser before the login screen; it has no business here at
-- all. Only `authenticated` gets DML, and RLS decides which rows that means.
revoke all on public.finance_accounts              from anon;
revoke all on public.finance_categories            from anon;
revoke all on public.finance_merchants             from anon;
revoke all on public.finance_merchant_patterns     from anon;
revoke all on public.finance_category_rules        from anon;
revoke all on public.finance_imports               from anon;
revoke all on public.finance_transactions          from anon;
revoke all on public.finance_transaction_overrides from anon;

grant select, insert, update, delete on public.finance_accounts              to authenticated;
grant select, insert, update, delete on public.finance_categories            to authenticated;
grant select, insert, update, delete on public.finance_merchants             to authenticated;
grant select, insert, update, delete on public.finance_merchant_patterns     to authenticated;
grant select, insert, update, delete on public.finance_category_rules        to authenticated;
grant select, insert, update, delete on public.finance_imports               to authenticated;
grant select, insert, update, delete on public.finance_transactions          to authenticated;
grant select, insert, update, delete on public.finance_transaction_overrides to authenticated;

-- ── updated_at ──────────────────────────────────────────────────────────────
drop trigger if exists finance_accounts_set_updated_at on public.finance_accounts;
create trigger finance_accounts_set_updated_at
  before update on public.finance_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists finance_categories_set_updated_at on public.finance_categories;
create trigger finance_categories_set_updated_at
  before update on public.finance_categories
  for each row execute function public.set_updated_at();

drop trigger if exists finance_merchants_set_updated_at on public.finance_merchants;
create trigger finance_merchants_set_updated_at
  before update on public.finance_merchants
  for each row execute function public.set_updated_at();

drop trigger if exists finance_merchant_patterns_set_updated_at on public.finance_merchant_patterns;
create trigger finance_merchant_patterns_set_updated_at
  before update on public.finance_merchant_patterns
  for each row execute function public.set_updated_at();

drop trigger if exists finance_category_rules_set_updated_at on public.finance_category_rules;
create trigger finance_category_rules_set_updated_at
  before update on public.finance_category_rules
  for each row execute function public.set_updated_at();

drop trigger if exists finance_imports_set_updated_at on public.finance_imports;
create trigger finance_imports_set_updated_at
  before update on public.finance_imports
  for each row execute function public.set_updated_at();

drop trigger if exists finance_transactions_set_updated_at on public.finance_transactions;
create trigger finance_transactions_set_updated_at
  before update on public.finance_transactions
  for each row execute function public.set_updated_at();

drop trigger if exists finance_transaction_overrides_set_updated_at on public.finance_transaction_overrides;
create trigger finance_transaction_overrides_set_updated_at
  before update on public.finance_transaction_overrides
  for each row execute function public.set_updated_at();

-- ── The one operation that may not be split: learning a merchant ────────────
-- What the user does is a single decision:
--
--   Raw:        REWE TROISDORF SAGT DANKE 8407
--   Marks:      REWE
--   Chooses:    Lebensmittel
--
-- What has to happen for it is five writes — merchant, pattern, rule, this
-- booking, and the other bookings the pattern now explains. As five client
-- calls, any failure in the middle leaves a merchant without a pattern or a
-- pattern without a rule, and the next screen shows a state nobody asked for.
-- So it is one function: PostgREST runs it inside one transaction, and a raise
-- anywhere in it rolls the whole decision back.
--
-- INVOKER RIGHTS ON PURPOSE. There is no `security definer` here and no
-- service-role key anywhere near the client: every statement below runs as the
-- signed-in user and is filtered by exactly the policies above. The function
-- can therefore not reach a row the caller could not have reached by hand — it
-- only makes the five writes atomic.
--
-- WHAT IT DOES NOT DO: it does not tokenise. That happens once, in
-- src/lib/finance/normalize.js, and the result is stored on the booking.
--
-- WHAT IT DOES NOT TAKE ON TRUST: the match set. The caller passes the ids its
-- backtest found in `p_apply_transaction_ids` — the same ones the user saw —
-- and every single one is re-checked here against that booking's own stored
-- tokens (public.finance_pattern_matches) before it is touched, on top of the
-- three conditions that protect a decision somebody already made. A client bug
-- can therefore narrow what gets re-labelled, never widen it.
create or replace function public.finance_learn_merchant_rule(
  p_transaction_id        uuid,
  p_category_slug         text,
  p_pattern_type          text,
  p_tokens                text[],
  p_merchant_id           uuid    default null,
  p_merchant_name         text    default null,
  p_review_mode           text    default null,
  p_min_amount_minor      bigint  default null,
  p_min_inclusive         boolean default true,
  p_max_amount_minor      bigint  default null,
  p_max_inclusive         boolean default true,
  p_rule_currency         text    default null,
  p_apply_transaction_ids uuid[]  default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user             uuid := (select auth.uid());
  v_tx               public.finance_transactions%rowtype;
  v_category_id      uuid;
  v_merchant_id      uuid;
  v_merchant_created boolean := false;
  v_pattern_id       uuid;
  v_pattern_owner    uuid;
  v_pattern_created  boolean := false;
  v_rule_id          uuid;
  v_rule_category    uuid;
  v_rule_created     boolean := false;
  v_rule_currency    text;
  v_applied          integer := 0;
  v_requested        integer := 0;
  v_tx_updated       boolean := false;
  v_name             text := btrim(coalesce(p_merchant_name, ''));
begin
  if v_user is null then
    raise exception 'finance: kein angemeldeter Benutzer' using errcode = '28000';
  end if;

  -- ── the booking this decision was made on ──
  select * into v_tx
  from public.finance_transactions
  where id = p_transaction_id and user_id = v_user;
  if not found then
    raise exception 'finance: Buchung % nicht gefunden', p_transaction_id using errcode = 'P0002';
  end if;

  -- ── the category, by its stable slug ──
  select id into v_category_id
  from public.finance_categories
  where user_id = v_user and slug = p_category_slug;
  if v_category_id is null then
    raise exception 'finance: Kategorie % gibt es nicht', p_category_slug using errcode = 'P0002';
  end if;

  -- ── the pattern the user actually marked ──
  -- Validated, never repaired: a pattern that is not normalised would be one
  -- the matcher can never match, and silently fixing it would store something
  -- the user did not choose.
  if p_pattern_type not in ('exact_token', 'exact_phrase') then
    raise exception 'finance: unbekannter Mustertyp %', p_pattern_type using errcode = '22023';
  end if;
  if not public.finance_tokens_normalized(p_tokens) then
    raise exception 'finance: Muster ist nicht normalisiert' using errcode = '22023';
  end if;
  if p_pattern_type = 'exact_token' and array_length(p_tokens, 1) <> 1 then
    raise exception 'finance: exact_token braucht genau ein Token' using errcode = '22023';
  end if;
  if p_pattern_type = 'exact_phrase' and array_length(p_tokens, 1) < 2 then
    raise exception 'finance: exact_phrase braucht mindestens zwei Tokens' using errcode = '22023';
  end if;
  if p_review_mode is not null and p_review_mode not in ('auto', 'conditional', 'always_review') then
    raise exception 'finance: unbekannter review_mode %', p_review_mode using errcode = '22023';
  end if;

  -- A pattern is what a human marked IN A BOOKING TEXT. If it does not occur in
  -- the booking this call names, it was not marked — it was constructed, by a
  -- bug or by hand. Refused before anything is written.
  if not public.finance_pattern_matches(p_pattern_type, p_tokens, v_tx.normalized_tokens) then
    raise exception 'finance: Muster % kommt in dieser Buchung nicht vor',
      array_to_string(p_tokens, ' ') using errcode = '22023';
  end if;

  -- ── the merchant: an existing one, or a new one under this name ──
  if p_merchant_id is not null then
    select id into v_merchant_id
    from public.finance_merchants
    where id = p_merchant_id and user_id = v_user;
    if v_merchant_id is null then
      raise exception 'finance: Händler % nicht gefunden', p_merchant_id using errcode = 'P0002';
    end if;
  else
    if v_name = '' then
      raise exception 'finance: Händlername fehlt' using errcode = '22023';
    end if;
    select id into v_merchant_id
    from public.finance_merchants
    where user_id = v_user and lower(btrim(canonical_name)) = lower(v_name);
    if v_merchant_id is null then
      insert into public.finance_merchants (user_id, canonical_name, review_mode)
      values (v_user, v_name, coalesce(p_review_mode, 'auto'))
      returning id into v_merchant_id;
      v_merchant_created := true;
    end if;
  end if;

  if p_review_mode is not null and not v_merchant_created then
    update public.finance_merchants
    set review_mode = p_review_mode
    where id = v_merchant_id and user_id = v_user and review_mode is distinct from p_review_mode;
  end if;

  -- ── the pattern ──
  -- An identical active pattern that belongs to a different merchant is not a
  -- duplicate, it is a permanent conflict: every booking it matches would be
  -- ambiguous forever. Refused here with a sentence the UI can show, before the
  -- unique index refuses it with an error code nobody can read.
  select id, merchant_id into v_pattern_id, v_pattern_owner
  from public.finance_merchant_patterns
  where user_id = v_user and active and pattern_type = p_pattern_type and tokens = p_tokens;

  if v_pattern_id is not null and v_pattern_owner <> v_merchant_id then
    raise exception 'finance: Muster % gehört bereits zu einem anderen Händler',
      array_to_string(p_tokens, ' ') using errcode = '23505';
  end if;

  if v_pattern_id is null then
    insert into public.finance_merchant_patterns (user_id, merchant_id, pattern_type, tokens)
    values (v_user, v_merchant_id, p_pattern_type, p_tokens)
    returning id into v_pattern_id;
    v_pattern_created := true;
  end if;

  -- ── the category rule ──
  -- An amount bound is a number in a currency; without one given, it is the
  -- currency of the booking the user was looking at.
  v_rule_currency := p_rule_currency;
  if v_rule_currency is null and (p_min_amount_minor is not null or p_max_amount_minor is not null) then
    v_rule_currency := v_tx.currency;
  end if;

  select id, category_id into v_rule_id, v_rule_category
  from public.finance_category_rules
  where user_id = v_user
    and merchant_id = v_merchant_id
    and active
    and min_amount_minor is not distinct from p_min_amount_minor
    and max_amount_minor is not distinct from p_max_amount_minor
    and min_inclusive = p_min_inclusive
    and max_inclusive = p_max_inclusive
    and currency is not distinct from v_rule_currency;

  if v_rule_id is null then
    insert into public.finance_category_rules (
      user_id, merchant_id, category_id,
      min_amount_minor, min_inclusive, max_amount_minor, max_inclusive, currency
    )
    values (
      v_user, v_merchant_id, v_category_id,
      p_min_amount_minor, p_min_inclusive, p_max_amount_minor, p_max_inclusive, v_rule_currency
    )
    returning id into v_rule_id;
    v_rule_created := true;
  elsif v_rule_category <> v_category_id then
    -- The user just said what this condition means. A deliberate statement
    -- replaces an older one; it does not pile a second rule on top of it.
    update public.finance_category_rules
    set category_id = v_category_id
    where id = v_rule_id and user_id = v_user;
  end if;

  -- ── the booking the user was looking at ──
  -- Two things decide what happens to it, and neither is "the client said so".
  --
  -- It is only assigned when nobody has decided it by hand. A booking the user
  -- locked or overrode keeps that decision: learning a general rule (case A)
  -- and correcting one single booking (case B) are different acts, and the
  -- second one is the more specific of the two. The rule is still created —
  -- the answer is "your rule is saved, this one booking stays as you set it",
  -- which `transaction_updated` in the result lets a screen say out loud.
  if v_tx.manual_lock = false and not exists (
    select 1 from public.finance_transaction_overrides o where o.transaction_id = v_tx.id
  ) then
    update public.finance_transactions
    set merchant_id = v_merchant_id, category_id = v_category_id
    where id = v_tx.id and user_id = v_user;
    v_tx_updated := true;
  end if;

  -- ── everything else the new pattern explains ──
  -- The client sends the ids its backtest found — the same ids the user saw
  -- before saving — and the database believes NONE of them. Every row has to
  -- pass, on its own stored tokens, the very match the pattern claims, plus the
  -- three conditions that protect a decision somebody already made: not
  -- assigned, not locked, no override.
  --
  -- So a bug in the client's match set cannot re-label a booking that does not
  -- contain the pattern, and a hand-made request cannot sweep up unrelated
  -- bookings. The applied set is always a subset of what the user was shown,
  -- and every member of it provably matches. `requested_count` next to
  -- `applied_count` makes the difference visible instead of silent.
  if p_apply_transaction_ids is not null then
    v_requested := coalesce(array_length(p_apply_transaction_ids, 1), 0);
  end if;

  if v_requested > 0 then
    update public.finance_transactions t
    set merchant_id = v_merchant_id, category_id = v_category_id
    where t.user_id = v_user
      and t.id = any (p_apply_transaction_ids)
      and t.id <> v_tx.id
      and t.merchant_id is null
      and t.manual_lock = false
      and public.finance_pattern_matches(p_pattern_type, p_tokens, t.normalized_tokens)
      and not exists (
        select 1 from public.finance_transaction_overrides o where o.transaction_id = t.id
      );
    get diagnostics v_applied = row_count;
  end if;

  return jsonb_build_object(
    'merchant_id',         v_merchant_id,
    'merchant_created',    v_merchant_created,
    'pattern_id',          v_pattern_id,
    'pattern_created',     v_pattern_created,
    'rule_id',             v_rule_id,
    'rule_created',        v_rule_created,
    'category_id',         v_category_id,
    'transaction_id',      v_tx.id,
    'transaction_updated', v_tx_updated,
    'requested_count',     v_requested,
    'applied_count',       v_applied
  );
end;
$$;

-- Reachable as /rest/v1/rpc/finance_learn_merchant_rule for a signed-in user
-- and for nobody else. The ownership helpers are only ever called from inside
-- a policy, so they are not offered to the outside world at all.
revoke all on function public.finance_learn_merchant_rule(
  uuid, text, text, text[], uuid, text, text, bigint, boolean, bigint, boolean, text, uuid[]
) from public, anon;
grant execute on function public.finance_learn_merchant_rule(
  uuid, text, text, text[], uuid, text, text, bigint, boolean, bigint, boolean, text, uuid[]
) to authenticated;

revoke all on function public.finance_seed_categories() from public, anon, authenticated;
revoke all on function public.finance_owns_account(uuid)     from public, anon;
revoke all on function public.finance_owns_import(uuid)      from public, anon;
revoke all on function public.finance_owns_merchant(uuid)    from public, anon;
revoke all on function public.finance_owns_category(uuid)    from public, anon;
revoke all on function public.finance_owns_transaction(uuid) from public, anon;
grant execute on function public.finance_owns_account(uuid)     to authenticated;
grant execute on function public.finance_owns_import(uuid)      to authenticated;
grant execute on function public.finance_owns_merchant(uuid)    to authenticated;
grant execute on function public.finance_owns_category(uuid)    to authenticated;
grant execute on function public.finance_owns_transaction(uuid) to authenticated;

-- ── Accounts that existed before this migration get their categories now ────
-- Same closing move as 0001: the trigger covers every future account, this
-- covers the ones that are already there. `on conflict do nothing` is what
-- makes running the file twice a no-op.
insert into public.finance_categories (user_id, slug, label, sort_order, is_system)
select u.id, d.slug, d.label, d.sort_order, true
from auth.users u
cross join public.finance_default_categories() d
on conflict (user_id, slug) do nothing;

-- ── Realtime: deliberately not yet ──────────────────────────────────────────
-- Nothing subscribes to these tables: this migration ships the model and the
-- rules, not a screen. Publishing a table is its own one-line step (0004), and
-- it belongs in the migration that brings the module's UI — publishing eight
-- tables nobody listens to would only widen what the WAL carries.
