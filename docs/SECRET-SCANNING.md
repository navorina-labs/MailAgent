# GitHub Secret Scanning (leaked keys)

GitHub scans public repositories, gists and issues for strings that match a partner's key pattern and reports each match to the partner. We revoke the key at once and email the owner.

## Endpoint

`POST https://api.webmailagent.com/webhooks/github/secret-scanning`

- Verifies `Github-Public-Key-Signature` (ECDSA P-256 / SHA-256, DER, base64) with the key named in `Github-Public-Key-Identifier`, from `https://api.github.com/meta/public_keys/secret_scanning` (cached 1 hour, refetched once on a miss).
- For each token that matches a live key: sets `revoked_at`, logs `github_secret_scanning_revoked`, emails a self-serve owner a masked notice with a link to `/get-key?replace`.
- Answers with `token_raw`, `token_type` and `label` (`true_positive` or `false_positive`) per token.

## What to send GitHub (one time, operator)

Apply at https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partnership-program/secret-scanning-partner-program with:

| Field | Value |
|---|---|
| Token type | `mailagent_api_key` |
| Regex | `\bma_[A-Za-z0-9_-]{32}\b` |
| Endpoint | `https://api.webmailagent.com/webhooks/github/secret-scanning` |
| Contact | hello@webmailagent.com |
| Example (fake) | `ma_` followed by 32 base64url characters |

GitHub may ask for a more distinctive prefix than `ma_`. If so, the cheapest change is a new prefix for newly issued keys (for example `mak_`), accepting both prefixes for a while.

## Test

`npm run test:github-secret-scanning` signs a payload with a generated P-256 key the way GitHub does and checks verification, tampering, wrong key id and DER parsing.
