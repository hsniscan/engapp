# 0002 — Google sign-in only; guest mode local-only; no anonymous AI

**Context.** Plan offered email+password and Google, and asked whether guests
may use AI via Supabase anonymous sessions.
**Decision.** Sign-in is Google only. Guest mode stays (full local use, offline,
works before the backend is configured). AI extraction/enrichment and sync
require a Google sign-in. No anonymous sessions.
**Why.** User's choice ("Google girişi gereklidir"). Removes password reset/SMTP
setup and the anonymous→real account linking step; guest→account migration
stays the simple "stamp user_id on local rows and push" flow.
