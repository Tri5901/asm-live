-- Carnet de bord des minuteurs (cron.job_run_details) : une ligne à chaque passage, plus de 1 000 par semaine, jamais effacées (22 Mo le 08/11).
-- Chaque nuit à 3 h UTC, on efface les lignes de plus de 15 jours (accord de Tristan, 08/11). Rien d'autre n'est touché.
select cron.schedule('purge-journal-minuteurs', '0 3 * * *', $c$ delete from cron.job_run_details where start_time < now() - interval '15 days' $c$);
delete from cron.job_run_details where start_time < now() - interval '15 days';
select jobname, schedule, active from cron.job where jobname = 'purge-journal-minuteurs';
