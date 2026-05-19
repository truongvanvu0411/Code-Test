# Lessons

## 2026-05-20 - Submission ID Validation

- Symptom: Admin submission listing and recording upload could not read a newly created submission.
- Root Cause: Submission lookup reused filename sanitization that lowercased timestamp characters, so valid IDs containing `T` and `Z` were rejected.
- Fix: Use a dedicated submission ID validator that allows alphanumeric characters, dots, underscores, and dashes without rewriting the ID.
- Prevention Rule: Do not reuse normalization helpers for validation when the original identifier must remain byte-for-byte stable.
- Example: `2026-05-19T15-20-24-089Z-demo-candidate-rental_cart` must remain unchanged when used as a directory name.
