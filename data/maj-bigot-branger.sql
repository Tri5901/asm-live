update public.matches set rosters = replace(replace(rosters::text, '"Djylane B."', '"Djylane Bigot"'), '"Sacha B."', '"Sacha Branger"')::jsonb
where competition in ('District 2 · J2', 'District 4 · J2');
select count(*) as corriges from public.matches where rosters::text like '%Djylane Bigot%' or rosters::text like '%Sacha Branger%';
