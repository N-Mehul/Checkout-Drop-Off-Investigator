"""
Gunicorn configuration for Checkout Drop-Off Investigator.
Automatically discovered and loaded when running `gunicorn app:app` on Render / Linux.

Key responsibilities:
1. Concurrency: Uses 1 worker with 4 threads by default (WEB_CONCURRENCY / GUNICORN_THREADS).
   This preserves the in-memory singleton DatasetRepository across requests while allowing
   concurrent request handling without process isolation.
2. post_fork hook: Starts the LiveGenerator inside the forked worker process. Because POSIX
   fork() does not clone threads from the master process, starting the background generator
   in post_fork ensures the live event stream is continuously running inside the worker.
3. worker_exit hook: Performs clean shutdown of the generator thread.
"""
import os
import sys

# Bind to the port provided by Render / environment
port = os.environ.get("PORT", "5000")
bind = f"0.0.0.0:{port}"

# Recommended concurrency for in-memory live stream
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))
threads = int(os.environ.get("GUNICORN_THREADS", "4"))
timeout = int(os.environ.get("GUNICORN_TIMEOUT", "120"))
keepalive = 5


def post_fork(server, worker):
    """
    Called immediately after a worker process has been forked.
    Starts the LiveEventGenerator background daemon thread inside the worker process.
    """
    server.log.info("Gunicorn worker spawned (pid: %s). Initializing LiveGenerator...", worker.pid)
    try:
        from backend.live_generator import start_live_generator
        start_live_generator(interval_seconds=3.0)
    except Exception as exc:
        server.log.error("Failed to start LiveGenerator in post_fork: %s", exc)


def worker_exit(server, worker):
    """
    Called just after a worker has exited, inside the worker process.
    Signals the LiveGenerator thread to stop cleanly.
    """
    try:
        from backend.live_generator import stop_live_generator
        stop_live_generator(timeout=2.0)
    except Exception:
        pass
