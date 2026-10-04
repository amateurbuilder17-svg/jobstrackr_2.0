-- ═══════════════════════════════════════════════════════════════════════════
-- Education · the rest of what an application form asks about a marksheet
-- ═══════════════════════════════════════════════════════════════════════════
-- A government form does not stop at "year of passing". It asks for the roll
-- number, the date the result was declared, the subjects, and marks obtained
-- out of maximum. The marksheet prompt has asked the model for most of these
-- since the old project; there was nowhere to put them, so the review screen
-- dropped them on the floor.
--
-- All nullable. A row typed in by hand on /profile will have none of them, and
-- "not known" is a legitimate answer for every one.

alter table public.education_qualifications
  add column roll_number     text,
  -- The date printed as "date of declaration of result" / "date of issue".
  -- A full date or nothing: never a year padded to 1 January, which is what
  -- `year_of_passing` is for.
  add column result_date     date,
  -- As printed, comma-separated. Forms take it as free text too.
  add column subjects        text,
  add column marks_obtained  numeric(7,2),
  add column max_marks       numeric(7,2),
  add column cgpa            numeric(4,2),

  add constraint education_roll_number_sane check (
    roll_number is null or char_length(roll_number) between 1 and 40
  ),
  add constraint education_subjects_sane check (
    subjects is null or char_length(subjects) <= 300
  ),
  add constraint education_result_date_sane check (
    result_date is null
    or result_date between date '1950-01-01' and current_date + interval '1 year'
  ),
  add constraint education_marks_sane check (
    (marks_obtained is null or marks_obtained >= 0)
    and (max_marks is null or max_marks > 0)
    and (marks_obtained is null or max_marks is null or marks_obtained <= max_marks)
  ),
  add constraint education_cgpa_sane check (
    cgpa is null or cgpa between 0 and 10
  );
