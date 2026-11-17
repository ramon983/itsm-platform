"""Domain errors mapped to HTTP responses in app.main."""

from __future__ import annotations


class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(DomainError):
    status_code = 404


class InvalidTransition(DomainError):
    status_code = 409


class PolicyViolation(DomainError):
    status_code = 422


class Forbidden(DomainError):
    status_code = 403
