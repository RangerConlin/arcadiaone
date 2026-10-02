# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository contains the production-oriented ArcadiaOne application foundation. The People module supports employee directory, employee profile, employee create/edit, department administration, position administration, qualification management, role-based user administration, and straightforward task/work management.

The following areas are intentionally not implemented yet: training/LMS, projects (beyond task linkage), scheduling, general document management, timekeeping, payroll, SSO/MFA, advanced permissions, notifications, external integrations, and reporting engine features.

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
- `Project`, `ProjectMember`, and `ProjectMilestone`
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
- Live task metrics on the dashboard

Calendar and Reports remain placeholders.

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

The seed creates `Arcadia Command Solutions`. Optional fictional development sample data is only created when `SEED_SAMPLE_DATA=true` is set.

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
