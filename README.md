# ArcadiaOne

ArcadiaOne is an employee-management and project-management web application for Arcadia Command Solutions.

## Status

This repository currently contains the initial production-capable application scaffold only. Employee management, project management, authentication, database models, permissions, and reporting features have not been implemented yet.

## Technology

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- React Compiler
- npm
- Docker production deployment with standalone Next.js output

## Local Development

Install dependencies:

```bash
npm install
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

The included `compose.yml` is configured for a host that already runs Traefik with the `websecure` entrypoint and `letsencrypt` certificate resolver.

ArcadiaOne is routed at:

```text
https://one.arcadiacommandsolutions.com
```

Deploy from the repository root on the VPS:

```bash
docker compose up -d --build
```

The application container exposes port `3000` to Docker for Traefik discovery and does not publish the port directly on the host.
