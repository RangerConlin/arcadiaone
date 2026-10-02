# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository contains the initial production-capable ArcadiaOne application foundation. The People module is the first functional area and supports employee directory, employee profile, employee create/edit, department administration, and position administration.

The following areas are intentionally not implemented yet: certifications, training, projects, tasks, scheduling, documents, timekeeping, payroll, authentication, advanced permissions, notifications, external integrations, and reporting engine features.

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

Placeholder navigation exists for Projects, Calendar, and Reports.

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

## Projects module

Projects are standalone organization-owned records and require only a name and lifecycle status. Optional metadata includes a human-readable number (unique within its organization), priority, dates, free-text client and location, and a primary project manager. This deliberately follows an **integration-point** design: projects do not require CRM clients, tasks, qualifications, invoices, rentals, documents, timekeeping, or portal records. Future modules should add explicit optional project foreign keys rather than make project creation depend on them.

A project can have employee memberships with reusable project roles. Project roles describe the employee's assignment on a project and are separate from job positions, application permissions, and qualifications. Ending a membership records `leftAt` and retains history. Lightweight milestones represent high-level checkpoints, while the activity stream stores manual notes and a small set of meaningful project events.

The current module includes the paginated/searchable project directory, create/edit forms, overview, team management, milestones, activity notes, project-role administration, dashboard counts, and employee-profile assignments. It intentionally does not implement tasks or any downstream commercial/document systems.

Project data access is organization-scoped on the server. ADMIN may administer all projects and project roles; MANAGER may create projects and manage projects where they are the assigned project manager; EMPLOYEE has read access only to assigned projects. The temporary server identity adapter in `src/modules/projects/authorization.ts` reads `ARCADIA_ROLE` and `ARCADIA_EMPLOYEE_ID`; it defaults to ADMIN to preserve the foundation application's current behavior and is the single seam to replace when the authentication provider is connected. UI visibility is not treated as authorization.
