"""Exchange ADAPTERS — the ONLY place in the service that may contain code that
can reach an exchange (spec §1). Everything outside this package is guaranteed
execution-free by tests/test_no_execution_code.py. An adapter here is still
inert until the worker is armed (which no agent ever does) and until the owners
have loaded keys into the vault (which no agent ever touches)."""
