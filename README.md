# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository contains the production-oriented ArcadiaOne application foundation. The People module supports employee directory, employee profile, employee create/edit, department administration, position administration, and role-based user administration.

The following areas are intentionally not implemented yet: certifications, training, projects, tasks, scheduling, documents, timekeeping, payroll, SSO/MFA, advanced permissions, notifications, external integrations, and reporting engine features.

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
- `User`
- `Session`
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
- Password login, secure server-side sessions, and logout
- Admin/manager/employee role enforcement
- User creation, activation, role assignment, and administrator password reset
- Self-service password change
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
