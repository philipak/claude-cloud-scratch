# claude-cloud-scratch

Scratch repo for exercising cloud sessions. Low stakes by design.

- Standard library only. Do not add dependencies or a package manager.
- Tests are stdlib `unittest`, run with
  `python3 -m unittest discover -s tests -v`. Keep it that way so the suite
  runs in a bare sandbox with no install step.
- Treat the tests as the specification. Change `src/`, not `tests/`, unless
  a test is provably wrong.
