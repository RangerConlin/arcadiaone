# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository contains the ArcadiaOne application foundation. The People module supports the employee directory, employee profiles, employee create/edit, department and position administration, and qualification management.

The following areas are intentionally not implemented yet: training/LMS, projects, tasks, scheduling, general document management, timekeeping, payroll, authentication, advanced permissions, notifications, external integrations, and reporting engine features.

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
- `SystemHealth`

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
- Database-backed `/api/health`

Placeholder navigation exists for Projects, Calendar, and Reports.

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
