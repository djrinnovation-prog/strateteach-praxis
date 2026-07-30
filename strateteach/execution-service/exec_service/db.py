"""Postgres access for the execution service — its OWN connection.

Deliberately does not import or reuse ``app.database`` from the browser-facing
backend. Same stack (psycopg 3 + Postgres), separate module, separate
connection string (``EXEC_DATABASE_URL``), so this directory can be lifted out
into its own service/repo (spec §10.1) without unpicking a shared import.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row


def database_url() -> str:
    """The execution service's own database URL.

    Separate from the main backend's DATABASE_URL on purpose: the execution
    plane is isolated from client money and from the demo AutoPilots (spec
    §0.7), and pointing it at its own database/credential keeps that true at
    the connection level rather than by convention.
    """
    url = os.environ.get("EXEC_DATABASE_URL")
    if not url:
        raise RuntimeError(
            "EXEC_DATABASE_URL is not set — the execution service uses its own "
            "database, separate from the main backend's DATABASE_URL."
        )
    return url


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Open a short-lived connection with dict rows.

    No pool yet: slice 1 has no request path and no worker, so a pool would be
    infrastructure with no caller. It arrives with the worker (slice 4).
    """
    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        yield conn


@contextmanager
def cursor(*, commit: bool = False) -> Iterator[Any]:
    with connect() as conn:
        with conn.cursor() as cur:
            yield cur
        if commit:
            conn.commit()
