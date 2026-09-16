"""Convert between compact duration strings ("1h30m") and seconds."""

import re

_UNITS = {"d": 86400, "h": 3600, "m": 60, "s": 1}
_TOKEN = re.compile(r"(\d+)([dhms])")


def parse_duration(text):
    """Parse a compact duration string into a whole number of seconds.

    >>> parse_duration("1h30m")
    5400
    """
    if not isinstance(text, str):
        raise TypeError("duration must be a string")

    stripped = text.strip().lower()
    if not stripped:
        raise ValueError("duration is empty")

    matches = list(_TOKEN.finditer(stripped))
    if not matches or "".join(m.group(0) for m in matches) != stripped:
        raise ValueError("malformed duration: %r" % text)

    return sum(int(value) * _UNITS[unit] for value, unit in
               (m.groups() for m in matches))


def format_duration(seconds):
    """Render a whole number of seconds as a compact duration string.

    The inverse of parse_duration: format_duration(5400) == "1h30m".
    Zero formats as "0s". Units that contribute nothing are omitted.
    """
    raise NotImplementedError("format_duration is not implemented yet")
