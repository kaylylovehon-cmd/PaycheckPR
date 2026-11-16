# Paycheck RP — Firestore Security Specification

## 1. Data Invariants
1. **Admin-Only Writes**: Only verified admins (`isAdmin()`) can create, update, or delete documents in `/paychecks/{paycheckId}` and `/admins/{adminUid}`.
2. **Public Dashboard Read**: `/paychecks/{paycheckId}` contains non-PII disbursement summary fields (`payee`, `paycheck`, `tax`, `netPay`, `date`, `note`) so anyone opening the shared dashboard link can view rankings without authentication. `/admins/{adminUid}` is strictly restricted to admins (`isAdmin()`).
3. **Strict Schema & Bounds**:
   - `payee` must be a non-empty string (`1..120` chars).
   - `paycheck`, `tax`, `netPay` must be finite numbers `>= 0` and `<= 1000000000`.
   - `date` must match `^\d{4}-\d{2}-\d{2}$` (`10` chars).
   - `note` must be a string (`<= 200` chars).
   - `createdBy` must equal `request.auth.uid` on create and remain immutable on update.
   - `createdAt` must equal `request.time` on create and remain immutable on update.
   - `updatedAt` must equal `request.time` on both create and update.
4. **No Shadow Fields**: Both `create` and `update` enforce `hasAll` and `hasOnly` / `affectedKeys().hasOnly(...)`.
5. **Path Variable Hardening**: Single-document operations validate `isValidId(...)` (`^[a-zA-Z0-9_\-]+$`, `1..128` chars).

## 2. Adversarial Payloads ("Dirty Dozen")
1. Unauthenticated `create` to `/paychecks/rec_1` -> **DENIED**
2. Non-admin authenticated user `create` to `/paychecks/rec_1` -> **DENIED**
3. Spoofed email (`kaylylovehon@gmail.com` with `email_verified: false`) `create` -> **DENIED**
4. Shadow field injection (`{ ..., isSuperAdmin: true }`) -> **DENIED**
5. Oversized `payee` string (`> 120` chars) or empty `payee` (`""`) -> **DENIED**
6. Oversized `note` string (`> 200` chars) -> **DENIED**
7. Invalid `date` format (`"16/11/2026"` or `"<script>"`) -> **DENIED**
8. Negative numeric values (`paycheck: -100`, `tax: -10`, `netPay: -50`) -> **DENIED**
9. Spoofed `createdBy` (`createdBy: "other_uid"`) on create -> **DENIED**
10. Mutating immutable `createdAt` or `createdBy` on update -> **DENIED**
11. Client-forged `createdAt` / `updatedAt` timestamp (`!= request.time`) -> **DENIED**
12. Poisoned document ID (`paycheckId` > 128 chars or containing invalid symbols) -> **DENIED**
13. Unauthenticated or non-admin read/write on `/admins/{uid}` -> **DENIED**
