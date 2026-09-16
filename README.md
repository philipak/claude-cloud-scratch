# claude-cloud-scratch

A deliberately tiny repo used to verify that Claude Code cloud sessions work
end to end: clone -> edit -> run tests -> commit -> open a PR.

Nothing here is precious. Break it freely.

## The code

`src/durations` converts between compact duration strings and seconds:

```python
parse_duration("1h30m")   # -> 5400
format_duration(5400)     # -> "1h30m"
```

`parse_duration` is implemented and its tests pass. `format_duration` is a
stub that raises `NotImplementedError`, so its tests fail. That failing half
is the point: it gives a cloud session a small, unambiguous task with an
objective finish line.

## Running the tests

Standard library only — no install step, no dependencies:

```
python3 -m unittest discover -s tests -v
```

## The task

Implement `format_duration` in `src/durations/core.py` so the whole suite
passes. It must be the exact inverse of `parse_duration`: largest units
first, units contributing nothing omitted, and `0` rendering as `"0s"`.
