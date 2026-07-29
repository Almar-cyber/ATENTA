// Read-only visibility into what's scheduled/queued/published — a companion to enqueue.ts,
// not a dashboard. Deliberately just a table on stdout (see architecture doc: "no custom admin
// UI for MVP" — this is the CLI equivalent of eyeballing the D1 Table Editor).
import { d1Query } from './d1-client.js';

interface Row {
  scheduled_for: string;
  platform: string;
  display_name: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  external_url: string | null;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const statusFilter = args.status;

  const rows = await d1Query<Row>(
    `select sp.scheduled_for, pt.platform, a.display_name, pt.status, pt.attempt_count, pt.last_error, pt.external_url
     from post_targets pt
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     join accounts a on a.id = pt.account_id
     ${statusFilter ? 'where pt.status = ?' : ''}
     order by sp.scheduled_for asc`,
    statusFilter ? [statusFilter] : []
  );

  if (rows.length === 0) {
    console.log(statusFilter ? `Nada com status "${statusFilter}".` : 'Fila vazia.');
    return;
  }

  console.table(
    rows.map((r) => ({
      quando: r.scheduled_for,
      plataforma: r.platform,
      conta: r.display_name,
      status: r.status,
      tentativas: r.attempt_count,
      erro: r.last_error ?? '',
      link: r.external_url ?? '',
    }))
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
