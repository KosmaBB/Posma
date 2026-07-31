# Security policy

POSMA performs system maintenance and asks for administrator rights to do
parts of it. Security reports are taken seriously and are welcome.

## Reporting a vulnerability

Email **kosma.brzezawski@gmail.com**.

Please include enough detail to reproduce: what you did, what happened, and
what you expected. If it matters, say which OS and which version or commit.

**Please do not open a public issue for something exploitable** until it has
been fixed. There is no bounty programme; there is a commitment to reply and
to credit you in the fix unless you would rather stay anonymous.

Expect a first response within a few days. This is a one-person project, not
a company with an on-call rota — if something is actively being exploited,
say so in the subject line.

## What is in scope

Anything that lets code or a person do more than they should:

- escaping the privilege boundary — getting an unprivileged module, or the
  UI, to make the broker perform something outside its operation catalog;
- getting a privileged operation to act on a target it should have refused
  (path traversal, whitelist bypass, symlink tricks, argument smuggling);
- defeating the daemon's caller authentication, or reaching it as another
  local user;
- extracting vault contents without the master password, or weakening the
  cryptography that protects them;
- destroying data through a path that was supposed to preview, back up or
  refuse first.

## What is out of scope

- **A confirmed destructive action doing what it says.** POSMA previews and
  asks; if you confirm deleting files, it deletes them.
- **Third-party modules you installed yourself.** They run unprivileged, but
  within your account they can do whatever your account can, and nobody has
  reviewed them.
- **An already-compromised user account.** The boundary here is user versus
  root, not defending against something already running as you.
- **Missing hardening in code that is documented as unfinished** — the macOS
  and Windows brokers have never run on real hardware, and Windows has no
  daemon mode at all. Reports that they are unverified are correct but
  already known; see [docs/security-model.md](docs/security-model.md).

## Supported versions

The project is pre-1.0 and unreleased. Fixes go to `master`; there are no
maintained release branches yet. Once 1.0 ships, this section will say which
versions receive fixes.

## Design context

[docs/security-model.md](docs/security-model.md) describes the privilege
model in full — what can reach root, what stops it, and an explicit list of
what is *not* protected. Reading it first will tell you whether something is
a bug or a documented limit.
