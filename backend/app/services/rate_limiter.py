"""In-memory login rate limiter (sliding-window failure counting).

Blocks a login key once too many failures accumulate inside a sliding
window; a successful login clears the window for that key.

Production limitations (accepted for the hackathon demo):
    - In-memory, per-process: state is lost on restart and NOT shared
      between workers. A production deployment needs a shared store
      (e.g. Redis) behind the same interface.
    - Windows are pruned lazily on access; abandoned keys with recent
      failures linger until their timestamps age out of the window.
"""

import time


class LoginRateLimiter:
    """Sliding-window limiter over consecutive login failures."""

    def __init__(self, max_failures: int = 10, window_seconds: float = 300.0):
        self._max_failures = max_failures
        self._window_seconds = window_seconds
        self._failures: dict[str, list[float]] = {}

    def is_blocked(self, key: str) -> bool:
        """Return True if the key has >= max_failures inside the window.

        Records nothing — safe to call on every login attempt.
        """
        now = time.monotonic()
        cutoff = now - self._window_seconds
        failures = [t for t in self._failures.get(key, ()) if t > cutoff]
        return len(failures) >= self._max_failures

    def record_failure(self, key: str) -> None:
        """Record one failed attempt for the key."""
        now = time.monotonic()
        cutoff = now - self._window_seconds
        failures = [t for t in self._failures.get(key, ()) if t > cutoff]
        failures.append(now)
        self._failures[key] = failures

    def record_success(self, key: str) -> None:
        """Clear the failure window for the key (successful login)."""
        self._failures.pop(key, None)

    def reset(self) -> None:
        """Clear all tracked state — test helper."""
        self._failures.clear()


# Module singleton used by the login endpoint
login_rate_limiter = LoginRateLimiter()
