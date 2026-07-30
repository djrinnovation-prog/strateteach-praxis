"""In-process signal-scan caches.

Shared singletons imported by both the signals router (fills them) and the meta
router (`/system/resync` clears them). Module-level dicts give every importer the
same objects, exactly as the original single-file app relied on.
"""
from __future__ import annotations

# Time-to-live for cached scans/charts, in seconds.
SCAN_CACHE_TTL = 15 * 60
CHART_CACHE_TTL = 30 * 60

# key -> {"data": ..., "ts": float}
scan_cache: dict[str, dict] = {}
trend_cache: dict[str, dict] = {}
chart_cache: dict[str, dict] = {}


def clear_all() -> None:
    """Drop every cached scan/trend/chart entry."""
    scan_cache.clear()
    trend_cache.clear()
    chart_cache.clear()
