# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository contains the production-capable ArcadiaOne foundation, including People and straightforward task/work management.

Advanced scheduling, timekeeping, billing, recurring tasks, custom workflows, notifications, and reporting engine features remain intentionally out of scope.

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
never accepted. `ARCADIA_CURRENT_USER_EMAIL` is the identity boundary for the
existing hosting authentication layer; local development falls back to the
seeded organization administrator. Production should set it only from a verified
session/gateway identity.

Overdue is computed at query/display time for an open task whose due date is in
the past. Completed and cancelled tasks are never overdue. Due soon means due
from now through seven days; the centralized `DUE_SOON_DAYS` constant is ready
for future organization-level configuration. Dates stay on `Task` so a future
calendar can consume them without duplicated calendar rows.

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
