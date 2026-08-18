-- Two columns that separate "when did this post enter processing" from "when was it last touched".
--
-- Before this, both lived in updated_at, and every recheck bumped it — which meant the 6h
-- processing timeout in stepSweeps could never fire (the row looked fresh again a minute later),
-- and there was nowhere to record when the next poll was due. At the old 10min cron that was
-- mostly invisible; at one minute a stuck post would be re-queried 360 times and still never time
-- out.
--
-- processing_since is set once, on entry, and cleared when the target is claimed for a new publish
-- attempt. next_check_after is the recheck clock: NULL means "check on the next tick", so a post
-- that just finished uploading is never made to wait.
alter table post_targets add column processing_since text;
alter table post_targets add column next_check_after text;

create index idx_post_targets_processing on post_targets (status, next_check_after);
