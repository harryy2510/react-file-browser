# Security Policy

## Supported Versions

The latest published release on npm receives security fixes. Older versions are not maintained.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, report them privately using GitHub's
[private vulnerability reporting](https://github.com/harryy2510/react-file-browser/security/advisories/new)
for this repository. If that is unavailable, contact the maintainer directly.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof-of-concept
- Affected version(s)

You can expect an initial response within a few business days. We will keep you informed as we work
on a fix and coordinate a disclosure timeline with you.

## Scope

react-file-browser ships UI and client logic only; it never runs server code and delegates all
storage access to a host-provided adapter. Server-side storage configuration (bucket policies,
lifecycle rules, signed-URL expiry, CORS) is the responsibility of the host application. Reports
about a host's storage misconfiguration should go to that host, not here.
