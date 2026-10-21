# 0003 — Gemini model

**Decision.** `GEMINI_MODEL=gemini-3.8-flash` (strongest model on the free tier,
Oct 2026; Pro and Gemini 4 models are paid-only), with automatic fallback to
`GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite` on quota errors. Both are server
secrets; no model name in code. Provider adapter allows switching later.
