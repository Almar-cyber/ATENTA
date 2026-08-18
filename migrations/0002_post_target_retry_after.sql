-- Per-target retry clock. handleFailure() used to write the backoff into post_targets.scheduled_for,
-- a column that only ever existed on scheduled_posts — so every retryable/quota failure threw
-- mid-poller, taking the whole cron run down with it (attempt_count never incremented, last_error
-- was never written, and the 30min stale-publishing sweep became the de facto retry every time).
--
-- It lives here rather than on scheduled_posts because the backoff belongs to one platform's
-- attempt: TikTok hitting spam_risk_too_many_posts must not push back the same post's YouTube or
-- LinkedIn targets. NULL means "nothing owed" — the normal state, and the reason a first
-- publication is never delayed by this column.
alter table post_targets add column retry_after text;

create index idx_post_targets_status_retry on post_targets (status, retry_after);
