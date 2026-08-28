-- ═══════════════════════════════════════════════════════════════════════════
-- The state filter has never filtered by state.
--
-- `jobs.state` is a verbatim copy of `jobs.location` on every row — 1,000 of
-- 1,000 sampled, 819 distinct values across the table including "New Delhi,
-- Delhi", "Chennai, Tamil Nadu", "Guwahati" and "Not Available". /jobs compares
-- it with `=`, so the "Tamil Nadu" chip matched 1 job while 20 named it, and
-- "Maharashtra" matched 6 of 38. The column holds a location; the filter wanted
-- a state.
--
-- `state_of()` derives one. Same shape as `level_of` and `stream_of`: normalise,
-- match, and return NULL when it cannot tell — accurate or absent, never a
-- guess. Measured against all 6,101 rows before this was written: 95.7% resolve,
-- and 98.6% of the rows carrying a real location at all. The remainder is almost
-- entirely the 180 rows that literally say "Not Available".
--
-- The order of the four passes is the design. An exact segment match beats a
-- substring one, and a state beats a city, so a city name appearing inside a
-- longer string cannot outrank a state named outright. Segments are read right
-- to left because Indian addresses put the state last.
--
-- One honest limit: a listing naming several places ("Tirupati, Trichy,
-- Madurai, Bhubaneswar, Udaipur") gets *a* state, not all of them — the
-- right-most one it recognises. A column cannot hold five answers, and the
-- alternative is excluding those rows from every chip. They stay findable by
-- search, which reads the whole location string.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.state_of(p_location text)
returns text
language plpgsql
immutable
as $$
declare
  t     text;
  segs  text[];
  seg   text;
  i     int;
  j     int;

  -- Canonical names plus the spellings the sources actually use. Keys are
  -- normalised: lower case, with `&` already expanded to " and ".
  states text[] := array[
    ['andaman', 'Andaman and Nicobar Islands'],
    ['andaman and nicobar', 'Andaman and Nicobar Islands'],
    ['andaman and nicobar islands', 'Andaman and Nicobar Islands'],
    ['andhra pradesh', 'Andhra Pradesh'],
    ['arunachal pradesh', 'Arunachal Pradesh'],
    ['assam', 'Assam'],
    ['bihar', 'Bihar'],
    ['chandigarh', 'Chandigarh'],
    ['chattisgarh', 'Chhattisgarh'],
    ['chhattisgarh', 'Chhattisgarh'],
    ['dadra and nagar haveli', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['dadra and nagar haveli and daman and diu', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['daman and diu', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['delhi', 'Delhi'],
    ['delhi ncr', 'Delhi'],
    ['goa', 'Goa'],
    ['gujarat', 'Gujarat'],
    ['haryana', 'Haryana'],
    ['himachal pradesh', 'Himachal Pradesh'],
    ['j and k', 'Jammu and Kashmir'],
    ['jammu and kashmir', 'Jammu and Kashmir'],
    ['jharkhand', 'Jharkhand'],
    ['karnataka', 'Karnataka'],
    ['kerala', 'Kerala'],
    ['ladakh', 'Ladakh'],
    ['lakshadweep', 'Lakshadweep'],
    ['madhya pradesh', 'Madhya Pradesh'],
    ['maharashtra', 'Maharashtra'],
    ['manipur', 'Manipur'],
    ['meghalaya', 'Meghalaya'],
    ['mizoram', 'Mizoram'],
    ['nagaland', 'Nagaland'],
    ['nct of delhi', 'Delhi'],
    ['new delhi', 'Delhi'],
    ['odisha', 'Odisha'],
    ['orissa', 'Odisha'],
    ['pondicherry', 'Puducherry'],
    ['puducherry', 'Puducherry'],
    ['punjab', 'Punjab'],
    ['rajasthan', 'Rajasthan'],
    ['sikkim', 'Sikkim'],
    ['tamil nadu', 'Tamil Nadu'],
    ['tamilnadu', 'Tamil Nadu'],
    ['telangana', 'Telangana'],
    ['tripura', 'Tripura'],
    ['uttar pradesh', 'Uttar Pradesh'],
    ['uttarakhand', 'Uttarakhand'],
    ['uttaranchal', 'Uttarakhand'],
    ['west bengal', 'West Bengal']
  ];

  -- Cities carry the state for every listing that names only a city, which is
  -- most of them. A curated list rather than a gazetteer on purpose: a wrong
  -- city-to-state mapping is invisible and files a job under the wrong state,
  -- so this holds the places that actually occur in this table.
  cities text[] := array[
    ['agartala', 'Tripura'],
    ['agra', 'Uttar Pradesh'],
    ['ahmedabad', 'Gujarat'],
    ['aizawl', 'Mizoram'],
    ['ajmer', 'Rajasthan'],
    ['alappuzha', 'Kerala'],
    ['aligarh', 'Uttar Pradesh'],
    ['allahabad', 'Uttar Pradesh'],
    ['ambala', 'Haryana'],
    ['amritsar', 'Punjab'],
    ['anand', 'Gujarat'],
    ['asansol', 'West Bengal'],
    ['aurangabad', 'Maharashtra'],
    ['bangalore', 'Karnataka'],
    ['bareilly', 'Uttar Pradesh'],
    ['baroda', 'Gujarat'],
    ['bathinda', 'Punjab'],
    ['belgaum', 'Karnataka'],
    ['bengaluru', 'Karnataka'],
    ['berhampur', 'Odisha'],
    ['bhagalpur', 'Bihar'],
    ['bhavnagar', 'Gujarat'],
    ['bhilai', 'Chhattisgarh'],
    ['bhopal', 'Madhya Pradesh'],
    ['bhubaneswar', 'Odisha'],
    ['bikaner', 'Rajasthan'],
    ['bilaspur', 'Chhattisgarh'],
    ['bokaro', 'Jharkhand'],
    ['bombay', 'Maharashtra'],
    ['calcutta', 'West Bengal'],
    ['calicut', 'Kerala'],
    ['chengalpattu', 'Tamil Nadu'],
    ['chennai', 'Tamil Nadu'],
    ['cochin', 'Kerala'],
    ['coimbatore', 'Tamil Nadu'],
    ['cuttack', 'Odisha'],
    ['darbhanga', 'Bihar'],
    ['dehradun', 'Uttarakhand'],
    ['delhi', 'Delhi'],
    ['deoghar', 'Jharkhand'],
    ['dhanbad', 'Jharkhand'],
    ['dharwad', 'Karnataka'],
    ['dibrugarh', 'Assam'],
    ['durg', 'Chhattisgarh'],
    ['durgapur', 'West Bengal'],
    ['ernakulam', 'Kerala'],
    ['erode', 'Tamil Nadu'],
    ['faridabad', 'Haryana'],
    ['gandhinagar', 'Gujarat'],
    ['gangtok', 'Sikkim'],
    ['gaya', 'Bihar'],
    ['ghaziabad', 'Uttar Pradesh'],
    ['gorakhpur', 'Uttar Pradesh'],
    ['greater noida', 'Uttar Pradesh'],
    ['guntur', 'Andhra Pradesh'],
    ['gurgaon', 'Haryana'],
    ['gurugram', 'Haryana'],
    ['guwahati', 'Assam'],
    ['gwalior', 'Madhya Pradesh'],
    ['hamirpur', 'Himachal Pradesh'],
    ['haridwar', 'Uttarakhand'],
    ['hisar', 'Haryana'],
    ['howrah', 'West Bengal'],
    ['hubli', 'Karnataka'],
    ['hyderabad', 'Telangana'],
    ['imphal', 'Manipur'],
    ['indore', 'Madhya Pradesh'],
    ['itanagar', 'Arunachal Pradesh'],
    ['jabalpur', 'Madhya Pradesh'],
    ['jaipur', 'Rajasthan'],
    ['jalandhar', 'Punjab'],
    ['jammu', 'Jammu and Kashmir'],
    ['jamshedpur', 'Jharkhand'],
    ['jhansi', 'Uttar Pradesh'],
    ['jodhpur', 'Rajasthan'],
    ['jorhat', 'Assam'],
    ['kalyani', 'West Bengal'],
    ['kancheepuram', 'Tamil Nadu'],
    ['kanchipuram', 'Tamil Nadu'],
    ['kannur', 'Kerala'],
    ['kanpur', 'Uttar Pradesh'],
    ['karimnagar', 'Telangana'],
    ['karnal', 'Haryana'],
    ['kharagpur', 'West Bengal'],
    ['kochi', 'Kerala'],
    ['kohima', 'Nagaland'],
    ['kolhapur', 'Maharashtra'],
    ['kolkata', 'West Bengal'],
    ['kollam', 'Kerala'],
    ['kota', 'Rajasthan'],
    ['kottayam', 'Kerala'],
    ['kozhikode', 'Kerala'],
    ['kurukshetra', 'Haryana'],
    ['leh', 'Ladakh'],
    ['lucknow', 'Uttar Pradesh'],
    ['ludhiana', 'Punjab'],
    ['madras', 'Tamil Nadu'],
    ['madurai', 'Tamil Nadu'],
    ['mandi', 'Himachal Pradesh'],
    ['mangalore', 'Karnataka'],
    ['manipal', 'Karnataka'],
    ['meerut', 'Uttar Pradesh'],
    ['mohali', 'Punjab'],
    ['mumbai', 'Maharashtra'],
    ['muzaffarpur', 'Bihar'],
    ['mysore', 'Karnataka'],
    ['mysuru', 'Karnataka'],
    ['nagpur', 'Maharashtra'],
    ['nainital', 'Uttarakhand'],
    ['nashik', 'Maharashtra'],
    ['navi mumbai', 'Maharashtra'],
    ['nellore', 'Andhra Pradesh'],
    ['new delhi', 'Delhi'],
    ['noida', 'Uttar Pradesh'],
    ['palakkad', 'Kerala'],
    ['panaji', 'Goa'],
    ['panipat', 'Haryana'],
    ['pantnagar', 'Uttarakhand'],
    ['patiala', 'Punjab'],
    ['patna', 'Bihar'],
    ['port blair', 'Andaman and Nicobar Islands'],
    ['prayagraj', 'Uttar Pradesh'],
    ['pune', 'Maharashtra'],
    ['raipur', 'Chhattisgarh'],
    ['rajkot', 'Gujarat'],
    ['ranchi', 'Jharkhand'],
    ['rishikesh', 'Uttarakhand'],
    ['rohtak', 'Haryana'],
    ['roorkee', 'Uttarakhand'],
    ['rourkela', 'Odisha'],
    ['sagar', 'Madhya Pradesh'],
    ['salem', 'Tamil Nadu'],
    ['sambalpur', 'Odisha'],
    ['secunderabad', 'Telangana'],
    ['shillong', 'Meghalaya'],
    ['shimla', 'Himachal Pradesh'],
    ['silchar', 'Assam'],
    ['siliguri', 'West Bengal'],
    ['solan', 'Himachal Pradesh'],
    ['solapur', 'Maharashtra'],
    ['sonipat', 'Haryana'],
    ['srinagar', 'Jammu and Kashmir'],
    ['surat', 'Gujarat'],
    ['tezpur', 'Assam'],
    ['thane', 'Maharashtra'],
    ['thanjavur', 'Tamil Nadu'],
    ['thiruvananthapuram', 'Kerala'],
    ['thrissur', 'Kerala'],
    ['tiruchirappalli', 'Tamil Nadu'],
    ['tirunelveli', 'Tamil Nadu'],
    ['tirupati', 'Andhra Pradesh'],
    ['tiruvallur', 'Tamil Nadu'],
    ['trichy', 'Tamil Nadu'],
    ['trivandrum', 'Kerala'],
    ['udaipur', 'Rajasthan'],
    ['udupi', 'Karnataka'],
    ['vadodara', 'Gujarat'],
    ['varanasi', 'Uttar Pradesh'],
    ['vellore', 'Tamil Nadu'],
    ['vijayawada', 'Andhra Pradesh'],
    ['visakhapatnam', 'Andhra Pradesh'],
    ['vizag', 'Andhra Pradesh'],
    ['warangal', 'Telangana']
  ];
begin
  t := lower(coalesce(p_location, ''));
  t := replace(t, '&', ' and ');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := btrim(t, ' .,;:-');

  if t = '' then
    return null;
  end if;

  -- Pan-India postings are a real answer, not a missing one: 2,367 rows say
  -- some form of "All India". Treating them as unknown would hide 39% of the
  -- table from every chip.
  if t ~ '^(all india|india|pan[ -]*india|across india|anywhere in india|all over india|various locations?( across india)?)$' then
    return 'All India';
  end if;

  segs := regexp_split_to_array(t, '[,/|()]');

  -- Pass 1 — a segment that IS a state.
  for i in reverse array_length(segs, 1)..1 loop
    seg := btrim(regexp_replace(segs[i], '\s+', ' ', 'g'), ' .,;:-');
    if seg <> '' then
      for j in 1..array_length(states, 1) loop
        if seg = states[j][1] then
          return states[j][2];
        end if;
      end loop;
    end if;
  end loop;

  -- Pass 2 — a segment that IS a known city.
  for i in reverse array_length(segs, 1)..1 loop
    seg := btrim(regexp_replace(segs[i], '\s+', ' ', 'g'), ' .,;:-');
    if seg <> '' then
      for j in 1..array_length(cities, 1) loop
        if seg = cities[j][1] then
          return cities[j][2];
        end if;
      end loop;
    end if;
  end loop;

  -- Pass 3 — a state named inside a longer segment ("posted at Kolkata West
  -- Bengal region"). Word-anchored, so "Goa" cannot match inside "Goalpara".
  for i in reverse array_length(segs, 1)..1 loop
    seg := regexp_replace(segs[i], '\s+', ' ', 'g');
    if seg <> '' then
      for j in 1..array_length(states, 1) loop
        if seg ~ ('\m' || states[j][1] || '\M') then
          return states[j][2];
        end if;
      end loop;
    end if;
  end loop;

  -- Pass 4 — a known city inside a longer segment.
  for i in reverse array_length(segs, 1)..1 loop
    seg := regexp_replace(segs[i], '\s+', ' ', 'g');
    if seg <> '' then
      for j in 1..array_length(cities, 1) loop
        if seg ~ ('\m' || cities[j][1] || '\M') then
          return cities[j][2];
        end if;
      end loop;
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.state_of is
  'Canonical Indian state or union territory for a free-text location, or '
  'NULL when it cannot be determined. "All India" is a value, not an absence. '
  'Exact segment matches beat substring ones and states beat cities, so a '
  'guess never outranks a fact.';

-- ── The column ─────────────────────────────────────────────────────────────
-- Generated, for the reason migration 0011 gives about `required_stream`: a
-- value an ingest path has to remember to write is a value that will be NULL
-- for a month before anyone notices. `jobs.state` is left exactly as it is —
-- nothing renders it, and rewriting 6,101 rows to fix a column no page reads
-- would be churn.
alter table public.jobs
  add column if not exists location_state text
  generated always as (public.state_of(location)) stored;

comment on column public.jobs.location_state is
  'State or union territory derived from `location`. What /jobs filters on. '
  '`state` is raw scraped text and is a copy of `location`; this is the '
  'normalised answer.';

-- Partial: the filter only ever asks for published rows, and a third of the
-- table is closed or draft at any time.
create index if not exists jobs_location_state_idx
  on public.jobs (location_state, last_date)
  where status = 'published';
