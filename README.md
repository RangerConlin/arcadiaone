# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application.

## Status

This repository contains the production-oriented ArcadiaOne application foundation. The People module supports employee directory, employee profile, employee create/edit, department administration, position administration, qualification management, role-based user administration, project management, and straightforward task/work management.

The following areas are intentionally not implemented yet: training/LMS, shift scheduling, timekeeping, payroll, SSO/MFA, advanced permissions, external integrations (including external calendar sync, email and SMS delivery), and reporting engine features.

## Technology

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- React Compiler
- PostgreSQL
- Prisma ORM
- npm
- Docker production deployment with standalone Next.js output

## Current Data Model

The database currently includes:

- `Organization`
- `Department`
- `Position`
- `Employee`
- `QualificationType`
- `EmployeeQualification`
- `PositionQualificationRequirement`
- `QualificationDocument` (metadata only)
- `User`
- `Session`
- `SystemHealth`
- `User`, with organization role and optional employee identity
- `Project`, `ProjectRole`, `ProjectMember`, `ProjectMilestone`, and `ProjectActivity`
- `Task`, `TaskChecklistItem`, `TaskComment`, and `TaskActivity`

Employees belong to an organization, may belong to a department and position, and may optionally reference another employee as their supervisor. Employee numbers are unique within an organization when provided.

## Application Areas

Implemented:

- Dashboard with live employee, department, and position counts
- People directory with search and filters
- Employee profile pages
- Employee create/edit forms with server-side validation
- Department create/edit/activate/deactivate
- Position create/edit/activate/deactivate
- Configurable qualification types and expiration rules
- Employee credential submission, editing, archival, and verification state
- Required/preferred qualifications by position
- Employee and organization-wide qualification status views
- Dashboard qualification attention counts
- Password login, secure server-side sessions, and logout
- Admin/manager/employee role enforcement
- User creation, activation, role assignment, and administrator password reset
- Self-service password change
- Database-backed `/api/health`

- Database-backed task list with search, status/priority/project/due filters, and pagination
- Personal assigned, due-soon, overdue, in-progress, and completed task views
- Standalone and project-linked task creation
- Task details, status/assignment/dates, full subtasks, lightweight checklist items, comments, and activity
- Project task filters and milestone completion progress
- Project directory with search/filters, create/edit, team memberships with reusable project roles, milestones, and activity notes
- Project-role administration and project assignments on employee profiles
- Live task metrics on the dashboard

Calendar and Notifications are described below. Reports remains a placeholder.

## Task Work Management

`Task.projectId` is nullable by design. Standalone work (for example, a license
renewal or vendor call) has the same assignment, priority, status, and due-date
capabilities as project work. Project tasks can additionally reference a
milestone. A task has one optional primary `Employee` assignee; an employee does
not need a user account to be assigned.

Subtasks are full task records in a one-level self-relation, so each may have its
own assignee, status, and dates. The server rejects self/circular relationships,
nested subtask parents, cross-organization parents, and parents from a different
project. Checklist items are deliberately smaller completion steps without an
assignee or dates.

Comments are plain text, unthreaded, and organization-scoped. Important changes
(creation, status/completion/reopening, assignment, due date, checklist, and
comments) append lightweight activity records for display and future notification
integration; this is not an event-sourcing system.

Task authorization is enforced in server queries and mutations:

- **ADMIN** can view and manage all tasks in their organization.
- **MANAGER** can see assigned/created work and project work for projects they
  manage or belong to; they can manage work they created or projects they manage.
- **EMPLOYEE** can see assigned work and projects where they are a member, update
  their assigned task's progress/status, use checklists, and comment. They cannot
  reassign or move tasks.

All related employee, project, milestone, parent, comment, and task lookups are
scoped to the server-resolved organization. Client-supplied organization IDs are
never accepted. The acting user comes from the authenticated server-side session.

Overdue is computed at query/display time for an open task whose due date is in
the past. Completed and cancelled tasks are never overdue. Due soon means due
from now through seven days; the centralized `DUE_SOON_DAYS` constant is ready
for future organization-level configuration. Dates stay on `Task` so a future
calendar can consume them without duplicated calendar rows.

## Qualifications architecture

`QualificationType` is an organization-scoped reusable definition. It supports a small category set, optional default issuer, credential/document expectations, and three expiration policies: no expiration, a manually tracked expiration, or an expiration calculated from the issue date and a default validity in calendar months. Administrators deactivate referenced types instead of deleting them.

`EmployeeQualification` records what an employee holds. Expiration state (`Current`, `Expiring soon`, `Expired`, or `No expiration`) is derived at read time by the reusable `src/modules/qualifications/status.ts` service. The organization owns one warning threshold (60 days by default), configurable on **Administration → Qualifications**. Position requirements are a separate many-to-many model and distinguish required from preferred credentials. Requirement evaluation also reports missing and unverified credentials without persisting derived state.

New and materially edited employee qualification records are always `UNVERIFIED`; an edit clears previous review metadata. A review can mark a record `VERIFIED` or `REJECTED`, retain its timestamp, and hold a short review note. The schema also reserves `verifiedByUserId` and uploader identifiers for the application identity layer. All current reads and writes derive the organization on the server and scope related-record validation to it.

`QualificationDocument` provides organization-scoped document metadata and an opaque storage key, deliberately keeping file content outside PostgreSQL. No binary storage backend or upload endpoint is enabled in this pass: this avoids implying secure storage exists and lets a future local-volume or S3-compatible adapter be introduced without changing qualification business logic. Once authentication is added, document download/upload routes must enforce employee visibility and role authorization before calling that adapter.

> **Authorization boundary:** this repository's foundation still does not contain authentication or user accounts. Qualification server actions follow the existing server-side organization boundary, but the role-specific ADMIN/MANAGER/EMPLOYEE rules cannot be securely enforced until an authenticated identity is available. Do not expose the application publicly before that prerequisite is implemented.

## Environment

Database credentials and connection settings live in a local `.env` file and are not committed to Git.

Create one from the example file:

```bash
cp .env.example .env
```

Then replace `POSTGRES_PASSWORD` with a strong password and keep `DATABASE_URL` in sync with the same database name, user, and password.

## Local Development

Install dependencies:

```bash
npm install
```

Generate Prisma Client:

```bash
npm run db:generate
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run linting:

```bash
npm run lint
```

Run task behavior tests and TypeScript validation:

```bash
npm test
npm run typecheck
```

Create a production build:

```bash
npm run build
```

Run local development migrations against the database configured in `.env`:

```bash
npm run db:migrate:dev
```

Seed the required organization record:

```bash
npm run db:seed
```

The seed creates the organization record, named by the `ORGANIZATION_NAME` environment variable (default `My Organization`), unless an organization already exists. The application is single-tenant: it uses the one organization record. Optional fictional development sample data is only created when `SEED_SAMPLE_DATA=true` is set.

Open Prisma Studio:

```bash
npm run db:studio
```

Check application and database health:

```text
http://localhost:3000/api/health
```

## Docker

Build the production image:

```bash
docker build -t arcadiaone .
```

Run the image locally:

```bash
docker run --rm -p 3000:3000 arcadiaone
```

## Production Deployment

The included `compose.yml` is configured for a host that already runs Traefik with the `websecure` entrypoint and `letsencrypt` certificate resolver. It also starts PostgreSQL on the internal Compose network only.

ArcadiaOne is routed at:

```text
https://one.arcadiacommandsolutions.com
```

Prepare the environment file on the VPS:

```bash
cp .env.example .env
```

Edit `.env` and set a production-strength `POSTGRES_PASSWORD`.

Build the application and migration images:

```bash
docker compose build
```

Apply production migrations explicitly:

```bash
docker compose run --rm migrate
```

Seed the required organization record from an application image/container with dependencies installed:

```bash
docker compose run --rm migrate npm run db:seed
```

Start the application and database:

```bash
docker compose up -d
```

The normal startup path is still:

```bash
docker compose up -d --build
```

Run migrations separately whenever new migration files are added.

The `worker` service (see [Scheduled jobs](#scheduled-jobs)) starts with the rest of the stack. It publishes no ports, has no Traefik labels, and restarts with `unless-stopped`. It needs the migrations applied before its first successful run; until then it logs the error and retries on its next interval.

PostgreSQL data persists in the named Docker volume `arcadiaone_postgres-data`, mounted at `/var/lib/postgresql` for PostgreSQL 18's versioned data directory layout. PostgreSQL port `5432` is not published to the host; it is reachable only by services on the internal Docker Compose network.

After deployment, check:

```text
https://one.arcadiacommandsolutions.com/api/health
```

The application container exposes port `3000` to Docker for Traefik discovery and does not publish the port directly on the host.

## Authentication and authorization

ArcadiaOne uses opaque, random, database-backed sessions. The browser receives only an `HttpOnly`, `SameSite=Lax` session cookie (also `Secure` in production); session records expire after eight hours. Account status is checked from PostgreSQL on every authenticated request, so deactivation immediately denies access. Passwords are salted and hashed with Node's memory-hard scrypt implementation and never stored reversibly. Next.js Server Actions provide origin validation for credential-changing POST requests.

Set `AUTH_SECRET` to at least 32 cryptographically random bytes in every production runtime. Generate one with `openssl rand -base64 48`; changing it invalidates every existing cookie. Production startup fails rather than using the development-only fallback when this variable is absent.

Roles are enforced server-side as follows:

- `ADMIN`: full employee maintenance and department, position, and user administration.
- `MANAGER`: directory visibility and profile visibility for all employees, with editing limited to employees whose `supervisorId` is the manager's linked employee record.
- `EMPLOYEE`: only the linked employee's own profile; employment details are read-only.

Unauthorized users are redirected to a consistent access-denied page. The health endpoint remains public and returns minimal status only.

### Create the first administrator

First seed the organization and apply migrations. Then provide bootstrap credentials only to the one command invocation:

```bash
BOOTSTRAP_ADMIN_EMAIL='admin@example.com' \
BOOTSTRAP_ADMIN_PASSWORD='a long temporary passphrase' \
npm run db:bootstrap-admin
```

Optionally set `BOOTSTRAP_ADMIN_EMPLOYEE_ID` to link an existing employee. The command refuses to run when any administrator already exists and never prints the password. Remove bootstrap values from the shell/environment afterward. Do not store real bootstrap credentials in `.env` or source control.

Visit `/login`, sign in with the bootstrap account, and change the temporary password on `/account`. There is no registration or email reset flow. Every user can change their password by supplying the current password; this revokes prior sessions. Administrators manage accounts at `/administration/users`, where they can create a linked or unlinked account, assign a role, deactivate access, or set a temporary password. Administrative resets also revoke existing sessions and mark the account for a password change.

For production, terminate TLS at Traefik, use unique strong database and auth secrets, restrict access to the deployment environment, apply migrations before starting the new image, and bootstrap the first administrator from a trusted terminal. Never send temporary passwords by email or place them in logs.

## Projects module

Projects are standalone organization-owned records and require only a name and lifecycle status. Optional metadata includes a human-readable number (unique within its organization), priority, dates, free-text client and location, and a primary project manager. This deliberately follows an **integration-point** design: projects do not require CRM clients, tasks, qualifications, invoices, rentals, documents, timekeeping, or portal records. Future modules should add explicit optional project foreign keys rather than make project creation depend on them.

A project can have employee memberships with reusable project roles. Project roles describe the employee's assignment on a project and are separate from job positions, application permissions, and qualifications. Ending a membership records `leftAt` and retains history. Lightweight milestones represent high-level checkpoints, while the activity stream stores manual notes and a small set of meaningful project events.

The current module includes the paginated/searchable project directory, create/edit forms, overview, team management, milestones, activity notes, project-role administration, dashboard counts, and employee-profile assignments. Task management lives in its own module and links to projects; no downstream commercial or document systems are implemented.

Project data access is organization-scoped on the server and enforced by the authenticated session (`src/modules/projects/authorization.ts`). ADMIN may administer all projects and project roles. MANAGER may create projects (as their own project manager) and manage projects where they are the assigned project manager. EMPLOYEE has read access only to projects they manage or actively belong to. Only ADMIN may change a project's manager. UI visibility is not treated as authorization.

Tasks reference projects and project milestones directly: a project detail page has a Tasks tab, and milestone progress is derived from linked tasks. Project managers are employees (`Project.projectManagerId`), not user accounts.

## Clients and relationship history

ArcadiaOne includes a deliberately lightweight client workspace. A `Client` is an independent organization/account and may be a `PROSPECT`, `ACTIVE`, `INACTIVE`, or `ARCHIVED`; making a prospect active is simply a status edit, not a sales pipeline. Client numbers are optional. Each client can have active or inactive contacts, with application logic maintaining at most one primary contact, and compact manual phone, email, meeting, note, or other activity entries.

Projects can optionally link to a client. The existing `Project.clientName` text remains intact for legacy records and unlisted clients, while `Project.clientId` provides navigation and reporting when a relationship is selected. Neither clients nor projects require the other. Organization-scoped server authorization limits employees to clients on projects they can see; managers can additionally work with clients they created or manage through a project; administrators can manage the full organization directory.

The relationships intentionally leave clean attachment points for future invoices, rentals, agreements, documents, e-signatures, and selectively provisioned client portal access. None of those modules—and no opportunities, forecasting, campaign, email-sync, or mandatory lead workflow—are implemented by this feature.

## Rental and equipment tracking

ArcadiaOne tracks **individual assets** in `Equipment`; inventory is useful even when an asset has never been rented. Organization-scoped, configurable categories and locations describe what an asset is and where it is. Operational `status` is deliberately separate from physical `condition`, and non-rentable or inactive assets remain visible in the inventory. Package models provide future reusable category-based selection templates without inventing stock quantities.

The intentionally small rental lifecycle is `DRAFT → RESERVED → PREPARING → READY → CHECKED_OUT → PARTIALLY_RETURNED/RETURNED → CLOSED`, with `CANCELLED` as a terminal alternative. Client, client contact, and project links are optional, so internal reservations are supported. Reservation dates are stored directly on the rental for later calendar integration.

Availability is centralized in `src/modules/rentals/availability.ts`. An asset must be active, rentable, and in an operationally eligible state, and it must have no rental item whose non-terminal rental overlaps the requested half-open date range (`existing.start < requested.end` and `existing.end > requested.start`). Cancelled and closed rentals do not block dates. Server actions repeat this conflict check when an item is added; the UI list is not treated as authoritative.

Preparation records a responsible employee, time, and simple item notes. Checkout snapshots the rate, rate unit, condition, time, notes, and responsible employee. Individual returns support partial-return state, snapshot return condition and notes, and require notes when condition worsens. Returned assets enter `INSPECTION`, never `AVAILABLE`; an administrator must return them to service or choose maintenance, out-of-service, or lost. Meaningful rental activity and item snapshots provide asset history without event sourcing.

Client and project relations are optional foreign keys and make linked rentals queryable from those workspaces without making either module dependent on rentals. The dashboard derives checked-out, due-soon, overdue, inspection, and maintenance counts from real data; overdue is calculated from expected return time and current lifecycle rather than stored.

Equipment defaults and rental-item rates are metadata only. The default is copied to the rental item when selected, preserving historical pricing; the displayed subtotal is explicitly an estimate. No tax, deposit, invoice, payment, or accounting transaction is created. A future invoice can reference the rental and its optional client/project while consuming these immutable item snapshots.

## Shared documents and file storage

ArcadiaOne models a **Document** as the independently managed logical record and stores every immutable binary as a numbered **DocumentVersion**. Explicit `DocumentRelation` foreign keys attach the same document to employees, qualifications, projects, tasks, clients, rentals, or equipment without copying the binary. Categories are organization-configurable; archive retains metadata, relations, and every version. This stable version identity is the intended anchor for future signature requests and signed-result versions—no e-signature behavior is included yet.

Route handlers and business services use the `ObjectStorage` boundary rather than filesystem calls. The initial `LocalObjectStorage` writes generated UUID keys with owner-only permissions beneath `DOCUMENT_STORAGE_PATH`; original filenames remain metadata only. Production Compose mounts the dedicated `document-data` volume at `/data/documents`. It is neither copied into the image nor exposed by Traefik, and all reads pass through the authenticated, organization-scoped download route. Back up this volume together with PostgreSQL so version metadata and objects stay consistent. A future S3-compatible implementation can replace this adapter without changing document business logic.

Uploads default to 25 MB (override with `DOCUMENT_MAX_UPLOAD_BYTES`) and accept PDFs, common raster images, Word/Excel formats, text, and CSV. Validation combines an allowlisted MIME/extension pair, size limits, safe filename normalization, and signatures for formats where practical; executable/web-active formats are rejected. Responses use safe content disposition, `nosniff`, private caching, and sandboxing. PDF and image preview uses the same authorized endpoint; there are no public object URLs.

Authorization is centralized and always organization-scoped. Administrators have broad access. Managers and employees require access through an explicit related business record, employees can see their own employee/qualification evidence, and restricted documents require elevated access. Metadata changes, uploads, versions, archive, and restore are recorded as document activity. Existing qualification file rows are retained by the migration and promoted to shared documents using their existing storage key.

For disaster recovery, snapshot the database and `document-data` volume at the same maintenance point, periodically test restores, and treat both as confidential. During a future S3 migration, copy objects by opaque `storageKey`, verify size/checksum, switch the storage adapter, and only retire the volume after authorized historical downloads have been validated.

## Invoices and e-signatures

### Invoice architecture

Invoices are organization-scoped billing records, not ledger entries. A client is required while project and rental links are optional. Drafts permit structural edits; issuing recalculates totals, allocates a number inside the same database transaction, freezes lines, and generates a PDF from the invoice's historical values. Statuses are `DRAFT`, `ISSUED`, `SENT`, `PARTIALLY_PAID`, `PAID`, and `VOID`; `OVERDUE` is presented as a derived state when a non-draft unpaid invoice is past due.

Organization settings contain the invoice prefix, concurrency-safe next sequence, default ISO 4217 currency, payment terms, footer, and billing address. Numbers are allocated with an atomic PostgreSQL `UPDATE … RETURNING`, never row counts. Each line uses PostgreSQL `Decimal` values. Central calculations multiply quantity and unit price, subtract the fixed line discount, calculate the configured percentage tax on the discounted line, and round to cents. Tests cover fractional quantities, discounts, taxes, invalid discounts, and overdue derivation.

Rental items can be copied into draft lines with source metadata; they are snapshots and later rental edits cannot rewrite them. Project selection is optional and no time billing is implied. Client, project, and rental workspaces link to the same invoices. Payments are lightweight records only—no processor or card/bank credentials. A payment cannot exceed the remaining balance. It recalculates paid/balance values and moves an invoice to partially paid or paid. Administrator corrections retain the original payment, mark it corrected with a reason/time, and recalculate rather than deleting history.

Generated PDFs are ordinary protected `Document`/`DocumentVersion` records in shared object storage. Issued documents are not regenerated in place; draft generation is allowed and issuing preserves a distinct immutable artifact. “Mark sent” records a manual action and does not claim email delivery. An invoice PDF may optionally enter the shared signature workflow.

### Signature architecture

`SignatureProvider` isolates create, send, status, cancel, completed-document, and audit operations. The initial `LOCAL` provider is explicitly a development workflow adapter and makes no legal-enforceability claim. Provider type, API URL/key, sender identity, webhook secret, and expiration are environment configuration; credentials are never stored in database settings. A production provider can implement the interface without provider-specific states leaking into application records.

Every request locks a specific `DocumentVersion` and supports ordered employee, client-contact, or manual external signers. Canonical request and signer statuses are mapped independently of provider vocabulary. Optional page-coordinate signature fields exist for providers that require placement; hosted provider preparation should otherwise be preferred.

The webhook endpoint requires an HMAC-SHA256 signature in `x-arcadia-signature`, rejects unsigned input, maps only known canonical states, and uses the provider event ID as an idempotency key. On completion the provider result is stored as a **new related document**, with its own version/checksum and copied business relations; it never overwrites the unsigned source. Provider event IDs, signer timestamps, completion/decline timestamps, audit reference, and metadata provide a practical audit trail.

### Security and future portal use

All reads and mutations derive organization identity from the authenticated session and re-check linked IDs server-side. Financial authorization is centralized: administrators have complete access, managers see drafts they created and invoices for projects they manage, and employees have no general financial access. Signature sending is a distinct permission from document viewing. Document downloads continue through protected document authorization. Issued invoices, payments, exact unsigned versions, and signed results use restrictive foreign-key deletion behavior.

The data model is ready for a future portal to grant an external identity access to selected invoices or signature requests, but this release creates no public invoice URL or client portal. It intentionally omits accounting ledgers, payment processing, tax jurisdiction logic, currency conversion, recurring billing, and email synchronization.

## Client Portal

ArcadiaOne serves the responsive Client Portal from `/portal` in the existing Next.js container and hostname. It is a separate application shell and security boundary, not the internal UI with hidden navigation.

### Identity, invitation, and sessions

External identities use `ClientPortalUser`, never the internal `User` model. Each identity is fixed to one organization and one client. Internal administrators and managers can open a Client's **Portal** tab, select an active contact with an email address, and generate a one-time 72-hour activation URL. Tokens are generated with cryptographic randomness, stored only as keyed hashes, expire, and are atomically marked used. Because this installation has no mail transport, the UI accurately presents a copy-once manual link rather than claiming an email was sent. Passwords use the same scrypt policy as internal accounts.

Portal sessions use their own `arcadia_portal_session` HttpOnly, SameSite=Lax cookie, token table, HMAC domain, 12-hour expiry, and `/portal` cookie path. They cannot satisfy internal authorization. Deactivation increments a session version and deletes sessions; every request also rechecks the portal user, contact, client status, and organization. Login and activation have bounded, in-process rate limiting suitable for the single-VPS deployment. Production cookies are Secure.

### Explicit access and client scoping

All portal reads derive `organizationId` and `clientId` from the authenticated portal session; browser-supplied client IDs are never authorization inputs. Direct object routes return not found unless both match. Existing records default closed after migration:

- Projects require `portalVisible`; only `clientDescription` and explicitly visible milestones/client descriptions are returned.
- Documents require an active `DocumentPortalShare`. Downloads stream the current version through an authenticated, no-store route; no storage key or public URL is exposed. Withdrawal is immediate.
- Invoices require `portalPublished` and a publishable state (`ISSUED`, `SENT`, `PARTIALLY_PAID`, `PAID`, or `OVERDUE`). Generated portal PDFs omit internal notes, payment references, and comments.
- Rentals require `portalVisible` and expose schedule, status, project (only if visible), and equipment name/asset number—not condition, damage, preparation, valuation, or replacement-cost fields.
- Signature requests are limited to signers connected to that client/contact. The portal reports provider state without duplicating or leaking provider metadata.
- `ClientApprovalRequest` is explicitly separate from legal e-signature. A pending response can transition once to approved or declined with an optional preserved comment and responder/timestamp.

### Administration and auditing

The internal Client **Portal** tab manages invitations, access revocation/reactivation, project publication, document share/withdrawal, invoice publication, and approval requests. It shows last login and current exposure without ever returning password hashes or token hashes. Meaningful events (login, activation, password change, document download, invoice view, and approval response) are recorded in `PortalActivity`; invasive analytics are intentionally absent. Future notifications can subscribe to these explicit workflow events without changing the portal authorization model.

Run the non-destructive migration with `npm run db:migrate`. Existing projects, milestones, rentals, invoices, and documents remain hidden by default.

## Calendar

`/calendar` (Month, Week and Agenda views), `/calendar/my` (personal calendar) and `/calendar/events/*` (standalone events).

### Aggregation architecture

The calendar is a **read-time aggregation**, not a second copy of the data. Dates already owned by another module are never duplicated into the calendar; each source reads its own table and maps rows to a read-only `CalendarItem` (`src/modules/calendar/sources.ts`):

| Type | Source fields |
| --- | --- |
| Project | `startDate`, `targetEndDate`, `actualEndDate` |
| Milestone | `ProjectMilestone.targetDate` |
| Task | `dueDate` (and `startDate` when it differs) |
| Qualification | `EmployeeQualification.expirationDate` |
| Rental | `reservationStart`–`reservationEnd` span, plus `checkedOutAt` / `returnedAt` |
| Invoice | `dueDate` |
| Signature | `SignatureRequest.expiresAt` (active requests) |
| Approval | `ClientApprovalRequest.dueAt`, or `requestedAt` when no due date exists (pending only) |
| General event | `CalendarEvent` (native, below) |

Clicking an item opens the source record in its own module; the calendar never edits another module's data and has no drag-and-drop, so every change goes through that module's existing business logic and authorization. Types are shown with an icon *and* a text label (color is only a secondary cue). Each source is capped at 500 rows per view; the page tells you to narrow filters when a cap is hit.

Filters (event type, project, client, employee, department, "assigned to me", completed/cancelled, and an agenda date range) are plain query parameters (`?view=agenda&types=TASK,RENTAL&project=…&date=2026-10-15&scope=mine`), so views are bookmarkable. Parameters are whitelisted and shape-validated; unknown values are ignored. A filter a source cannot honor (for example an employee filter on invoices) removes that source instead of silently ignoring the filter.

### Native `CalendarEvent` records

Only events that do not exist elsewhere are stored in `CalendarEvent` (title, description, `startAt`, `endAt`, `allDay`, location, visibility, `assignedEmployeeId`, optional `projectId` / `clientId`, creator, and cancellation state). Creation is lightweight and needs no project. Events can be edited or cancelled (cancelled events are kept, hidden by default). External-provider identifiers are deliberately **not** stored on `CalendarEvent` or any business record.

### Permissions

Calendar visibility is the source module's own visibility rule, reused directly (`projectVisibilityWhere`, `taskVisibilityWhere`, `invoiceVisibilityWhere`, `clientVisibilityWhere`, and the signature rule mirrored in `calendar/authorization.ts`). There is no calendar-specific bypass:

- Employees see only tasks assigned to them or on their projects, their own qualification expirations, signatures tied to them or their projects, and never invoice or approval dates.
- Managers see projects they manage or belong to, invoices they created or whose project they manage, and approvals for clients they can access. Qualifications follow the existing staff rule (administrators and managers see the organization's employees).
- Rentals are organization-wide, as in the Rentals module.
- Client portal users have a separate session and cannot reach any internal route.

Native event visibility: **Private** (creator and assignee only; administrators do not see other people's private events), **Project** (anyone who may see the linked project), **Organization** (all internal users). Organization-wide events and assigning events to other people require a manager or administrator; anyone may create private or project events and assign themselves. Edit/cancel is limited to the creator, an administrator, or the manager of the linked project. Links to projects, clients and employees are validated server-side against the same visibility rules.

### Time zones

- Timestamps (rentals, signature deadlines, approval times, timed events) are stored in UTC and rendered in the viewer's zone: the user's setting (**Account → Time zone**), else the organization zone (**Administration → Calendar and reminders**), else UTC.
- **Date-only** values (task and milestone dates, project dates, qualification expirations, invoice due dates, all-day events) are stored as a date and bucketed by their UTC calendar date. They are never converted, so a qualification expiring on 2026-10-25 is on Oct 25 in every zone.
- Timed events are entered in the viewer's zone and converted with an offset-aware, DST-safe conversion. Helpers and tests live in `src/lib/datetime.ts`.
- Overdue is a date comparison: an item due today is not overdue until the next day in the relevant zone.

### Future external sync

Google Calendar, Microsoft 365 and iCalendar feeds are not implemented. The design leaves a clean seam: `getCalendarItems()` already produces provider-neutral items (stable `key`, instants or date-only days, `href`), so a future exporter can serialize them for the requesting user (with a revocable per-user token) and an importer can map external events to `CalendarEvent` through a separate link table (`provider`, `externalId`, `eventId`) rather than adding provider columns to business records.

## Notifications

In-app notifications for actionable changes and reminders: the bell in the header (unread count, recent items, link to everything), `/notifications` (Unread / All / Dismissed, mark read, mark all read, dismiss, 25 per page) and `/notifications/preferences`.

### Architecture

- `Notification` is a **communication record**, not business state. Reading or dismissing one never changes a task, invoice or rental, and dashboards and source records keep showing reality. Overdue/expired notifications can be read but not dismissed.
- Rows are written **only** by `notify()` in `src/modules/notifications/service.ts`. It resolves the recipient (active, same organization), applies role guards (employees never receive invoice notifications), honors preferences, validates the link, and enforces idempotency. Nothing else inserts notifications.
- Immediate events live in `events.ts`: `notifyTaskAssigned`, `notifyProjectMemberAdded`, `notifySignatureRequested` (internal signers), `notifyApprovalRequested`, `notifyClientResponseReceived` (portal response → requester and project manager) and `notifyDocumentShared` (recipients are filtered through the document visibility policy). They are called by the existing actions after a successful change, never notify the person who made the change, and swallow their own errors so they cannot break the action.
- Links: `actionUrl` is built server-side from fixed templates in `links.ts` (`/tasks/:id`, `/invoices/:id`, …) and re-checked against an allow-list. The UI links to `/notifications/open/:id`, which marks the caller's own notification read and redirects to the stored link; no redirect target is ever taken from a request. The destination page applies its normal authorization, so a link to a record you cannot open still gets "not found / forbidden".
- Everything is scoped by both the authenticated user and organization; organization IDs from the browser are never trusted.
- Client portal users are **not** notification recipients (`Notification.userId` references the internal `User`). Client-facing items stay in the portal's Action Required area.

### Preferences and channels

`NotificationPreference` is keyed by `(user, category, channel)`; a missing row means the default (in-app on). Categories: task assignments, task due reminders, qualification expiration, rentals, invoices, signatures, approvals, project updates, documents. Only the **in-app** channel exists. `channels.ts` defines the delivery-channel and vendor-neutral `Mailer` interfaces; no mail provider is registered, so email is disabled, the UI shows it as unavailable, and nothing is ever reported as emailed. SMS is not implemented.

### Scheduled jobs

Condition-based reminders are evaluated by `runNotificationJobs()` (`src/modules/notifications/jobs.ts`), which is free of Next.js-only imports so a plain Node process can run it:

- **Docker (default):** the `worker` Compose service runs `npm run worker`, which evaluates every `NOTIFICATION_JOB_INTERVAL_MINUTES` (default 15), never overlapping itself, and shuts down cleanly on SIGTERM. It reuses the application source and dependencies via the `worker` Dockerfile target, publishes no ports and has no Traefik labels.
- **Host cron alternative:** run `npm run jobs:notifications` once per invocation (for example `*/15 * * * * cd /srv/arcadiaone && docker compose run --rm worker npm run jobs:notifications`) and stop the `worker` service.

What is checked (all per organization, "today" in the organization time zone):

| Condition | Rule |
| --- | --- |
| Task due soon / due tomorrow / overdue | open, assigned tasks; window = organization `taskDueSoonDays` (default 7) |
| Qualification expiring / expired | window = existing `qualificationExpirationWarningDays`; reminders at that window, then 30 and 7 days (only tiers inside the window) |
| Rental due back / overdue | checked-out rentals; window = `rentalDueSoonDays` (default 3) |
| Invoice due soon / overdue | open invoices with a balance; window = `invoiceDueSoonDays` (default 7) |

Recipients are the people directly responsible (task assignee, the credential holder, the rental's creator/checkout/prep staff, the invoice creator and project manager). There is no escalation: managers are not notified about other people's items; they see overdue work through dashboards and the calendar. Items that became overdue more than 30 days ago are not announced retroactively (this avoids a flood the first time the worker runs). Thresholds are organization settings, edited under **Administration → Calendar and reminders** (qualification warning days stay under Qualifications), not constants scattered through the code.

### Idempotency

Each condition has a deterministic key stored in `Notification.dedupeKey` under a unique `(userId, dedupeKey)` index, for example `task-overdue:<taskId>:<dueDate>` or `qualification-expiring:<id>:<expirationDate>:<tier>`. The job prefilters existing keys in bulk, and the unique index is the final guard, so repeated or overlapping runs cannot create duplicates. The relevant date is part of the key: changing a due date or renewing a credential starts a new reminder cycle. Marking read, dismissing or archiving never frees a key, so a still-true condition is not re-announced.

### Retention

Read or dismissed notifications older than `notificationArchiveAfterDays` (default 90; `0` disables) are **archived** by the job: hidden from lists but kept so their idempotency keys continue to work. Everything is paginated. Future options: hard-delete archived rows after a longer window once keys are no longer needed (for example by moving dedupe keys to their own table), per-type retention, and per-user digests.

### Future email

To add email: implement `Mailer` for the chosen provider (SMTP or an API), register it with `registerMailer()` at worker startup, and add an email dispatch step after `notify()` that honors `NotificationPreference` rows with `channel = EMAIL`. Notification logic never imports a vendor SDK.

### Testing

`npm test` runs the pure unit tests (dates, links, reminder tiers). `npm run test:integration` (needs a throwaway PostgreSQL via `DATABASE_URL`, and sets `INTEGRATION_TESTS=1`) exercises calendar aggregation, per-role authorization, time-zone behavior, filters, every immediate notification, scheduled reminders, idempotency, preferences, dismissal rules, pagination, organization isolation and link safety.

The calendar/notification migration (`20261002070000_calendar_notifications`) is purely additive (new tables, enums and defaulted columns) and preserves production data. Apply it with `npm run db:migrate`.
