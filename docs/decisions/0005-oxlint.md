# 0005 — oxlint instead of ESLint

The Vite 8 template ships oxlint; it is much faster and covers the rules we
need (including `no-restricted-imports` for keeping `src/domain/` pure).
