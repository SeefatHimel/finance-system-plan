from django.http import JsonResponse
from django.db import connection, DatabaseError
from django.db.migrations.executor import MigrationExecutor


def health(request):
    response = JsonResponse({"status": "ok"})
    response["Cache-Control"] = "no-store"
    return response


def readiness(request):
    """Liveness stays cheap; readiness verifies the database and deployed schema."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        executor = MigrationExecutor(connection)
        ready = not executor.migration_plan(executor.loader.graph.leaf_nodes())
    except (DatabaseError, OSError):
        ready = False
    response = JsonResponse({"status": "ready" if ready else "unavailable"}, status=200 if ready else 503)
    response["Cache-Control"] = "no-store"
    return response

