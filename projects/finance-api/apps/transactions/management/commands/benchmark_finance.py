"""Repeatable, synthetic-only ledger load generator and endpoint benchmark."""

import json
import math
import platform
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from time import perf_counter
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, close_old_connections
from rest_framework.test import APIClient
from apps.accounts.models import Account
from apps.transactions.models import Transaction


class Command(BaseCommand):
    help = (
        "Synthetic performance test. Refuses all databases outside finance_benchmark_*."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--rows", type=int, choices=(10000, 100000, 1000000), default=10000
        )
        parser.add_argument("--concurrency", default="1,10,25")
        parser.add_argument("--requests", type=int, default=25)
        parser.add_argument("--endpoints", default="activity,totals,accounts,report")
        parser.add_argument("--output")

    def handle(self, *args, **options):
        if connection.vendor != "postgresql" or not str(
            settings.DATABASES["default"]["NAME"]
        ).startswith("finance_benchmark_"):
            raise CommandError(
                "Use an isolated PostgreSQL database named finance_benchmark_*. No changes made."
            )
        try:
            levels = [int(value) for value in options["concurrency"].split(",")]
            if (
                any(value not in (1, 10, 25) for value in levels)
                or not 1 <= options["requests"] <= 100
            ):
                raise ValueError()
        except ValueError as error:
            raise CommandError("Use concurrency 1,10,25 and requests 1–100.") from error
        paths = {
            "activity": "/api/transactions/activity/?limit=25",
            "totals": "/api/transactions/totals/",
            "accounts": "/api/accounts/",
            "report": "/api/reports/monthly/?start_date=2025-01-01&end_date=2025-12-31",
        }
        names = options["endpoints"].split(",")
        if any(name not in paths for name in names):
            raise CommandError("Unknown endpoint selection.")
        if get_user_model().objects.exclude(username="synthetic-benchmark").exists():
            raise CommandError(
                "This database contains unrelated users. Use a fresh disposable database."
            )
        user, _ = get_user_model().objects.get_or_create(username="synthetic-benchmark")
        accounts = [
            Account.objects.get_or_create(
                user=user, name=f"Synthetic bank {n:02}", defaults={"type": "bank"}
            )[0]
            for n in range(12)
        ]
        count = Transaction.objects.filter(user=user).count()
        if count > options["rows"]:
            raise CommandError("Use a fresh database for a smaller benchmark.")
        account_ids = [str(account.pk) for account in accounts]
        if count < options["rows"]:
            with connection.cursor() as cursor:
                cursor.execute(
                    """INSERT INTO transactions_transaction
                  (id,user_id,account_id,transfer_account_id,date,time,type,direction,amount,balance_after,sender_account_identifier,sender_card_identifier,receiver_account_identifier,receiver_card_identifier,reference,counterparty_text,external_key,note,source,needs_review,created_at,updated_at)
                  SELECT md5('synthetic-benchmark:'||n)::uuid,%s,(%s::uuid[])[1+n%%12],
                    CASE WHEN n%%10=5 THEN (%s::uuid[])[1+(n+1)%%12] ELSE NULL END,
                    date '2025-01-01'+(n%%365)::int, time '00:00:00'+(n%%86400)*interval '1 second',
                    CASE WHEN n%%10=0 THEN 'income' WHEN n%%10=5 THEN 'transfer' ELSE 'expense' END,
                    CASE WHEN n%%10=0 THEN 'credit' ELSE 'debit' END,10.25,
                    CASE WHEN n%%100=1 THEN 1000 ELSE NULL END,
                    '','','','','','Synthetic merchant '||(n%%50),'synthetic-bench:'||n,repeat('Synthetic note. ',12),'system',false,
                    timestamptz '2025-01-01 00:00:00+00'+n*interval '1 second',timestamptz '2025-01-01 00:00:00+00'+n*interval '1 second'
                  FROM generate_series(%s::bigint,%s::bigint) AS series(n)""",
                    [user.pk, account_ids, account_ids, count, options["rows"] - 1],
                )
                cursor.execute(
                    """INSERT INTO transactions_transferevidence
                  (id,user_id,transaction_id,account_id,direction,date,time,balance_after,is_effective_balance,reference,provider,external_key,source,note,created_at)
                  SELECT md5('synthetic-evidence:'||t.id::text||side)::uuid,t.user_id,t.id,
                    CASE WHEN side='debit' THEN t.account_id ELSE t.transfer_account_id END,
                    side,t.date,t.time,1000,false,'','','synthetic-evidence:'||t.id::text||side,'system','Synthetic report',t.created_at
                  FROM transactions_transaction t CROSS JOIN (VALUES ('debit'),('credit')) AS sides(side)
                  WHERE t.user_id=%s AND t.type='transfer' AND NOT EXISTS
                    (SELECT 1 FROM transactions_transferevidence e WHERE e.user_id=t.user_id AND e.external_key='synthetic-evidence:'||t.id::text||side)""",
                    [user.pk],
                )
        with connection.cursor() as cursor:
            cursor.execute("ANALYZE accounts_account")
            cursor.execute("VACUUM ANALYZE transactions_transaction")
            cursor.execute("VACUUM ANALYZE transactions_transferevidence")
        results = []
        for name in names:
            for concurrency in levels:

                def measure(_):
                    close_old_connections()
                    started = perf_counter()
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute("SET statement_timeout='30s'")
                        client = APIClient()
                        client.force_authenticate(user)
                        response = client.get(paths[name], HTTP_HOST="localhost")
                        return (perf_counter() - started) * 1000, response.status_code
                    except Exception:
                        return (perf_counter() - started) * 1000, 500
                    finally:
                        close_old_connections()

                started = perf_counter()
                with ThreadPoolExecutor(max_workers=concurrency) as pool:
                    samples = list(
                        pool.map(measure, range(max(concurrency, options["requests"])))
                    )
                times = sorted(value for value, _ in samples)
                results.append(
                    {
                        "endpoint": name,
                        "concurrency": concurrency,
                        "requests": len(samples),
                        "p50_ms": round(times[len(times) // 2], 2),
                        "p95_ms": round(times[math.ceil(len(times) * 0.95) - 1], 2),
                        "errors": sum(status != 200 for _, status in samples),
                        "elapsed_s": round(perf_counter() - started, 2),
                    }
                )
                self.stderr.write(json.dumps(results[-1]))
        report = {
            "synthetic": True,
            "rows": options["rows"],
            "python": platform.python_version(),
            "postgres": connection.pg_version,
            "results": results,
        }
        output = json.dumps(report, indent=2)
        if options["output"]:
            Path(options["output"]).write_text(output + "\n")
        else:
            self.stdout.write(output)
        if any(result["errors"] for result in results):
            raise CommandError("Benchmark observed errors. See the synthetic report.")
