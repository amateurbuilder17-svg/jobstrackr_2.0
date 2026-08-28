-- ═══════════════════════════════════════════════════════════════════════════
-- 0025 · Module 19 · The model that can actually ground
-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 defaulted `model_name` to gemini-3.5-flash. Tested against a live
-- free-tier key, that model cannot do this job:
--
--   grounded   → 429 RESOURCE_EXHAUSTED. Google Search grounding carries its
--                own quota, and there is none on the free tier for this model.
--   ungrounded → MALFORMED_FUNCTION_CALL with zero text, on a prompt asking for
--                JSON. Raising maxOutputTokens from 4,096 to 16,384 changed
--                nothing; the model mangles its own structured output.
--
-- gemini-2.5-flash answered the same grounded prompt first time, and grounding
-- is not optional here — an ungrounded answer about this week's admit card is
-- exactly the failure this feature exists to prevent.
--
-- Only the default moves. Any row may still pin its own model, which is the
-- point of the column: when 3.5-flash gains grounding quota, one key can be
-- switched to it and watched before the rest follow.
alter table public.api_keys_config
  alter column model_name set default 'gemini-2.5-flash';

comment on column public.api_keys_config.model_name is
  'Per-key model. Default gemini-2.5-flash because it is the cheapest model '
  'measured to support Google Search grounding on the free tier — see 0025.';
