# Quadratic – Minimal Issue Tracker

A minimal issue tracking tool built with TypeScript, Express, and Prisma (Postgres). Issues are linked to GitHub repositories via a GitHub App, and users log in with GitHub OAuth.

## Architecture

- **Authentication**: GitHub OAuth (via a GitHub App's OAuth flow)
- **Repository linking**: A GitHub App is installed on repositories; webhook events sync installations and repositories
- **Database**: PostgreSQL with Prisma ORM
- **API**: RESTful JSON API built with Express

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for local PostgreSQL), or an existing PostgreSQL database
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with:
  - **OAuth** enabled (Client ID + Client Secret)
  - **Webhook URL** pointed at `<your-base-url>/webhooks/github`
  - **Webhook secret** configured
  - Permissions: `Repository metadata: Read-only`
  - Subscribe to events: `Installation`, `Installation repositories`
  - Note the App's **slug** (the part of `https://github.com/apps/<slug>`); set it as `GITHUB_APP_SLUG` so the UI can link to the install page

## Setup

1. **Start the database**

   ```bash
   docker compose up -d
   ```

   This starts a local PostgreSQL instance matching the defaults in `.env.example`.

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your database URL, GitHub App credentials, etc.
   ```

4. **Run database migrations**

   ```bash
   npm run db:push
   ```

5. **Start the server**

   ```bash
   # Development
   npm run dev

   # Production
   npm run build
   npm start
   ```

   Then open [http://localhost:3000](http://localhost:3000) in your browser to
   sign in with GitHub, install the App on your repositories, and start
   managing issues.

## Web UI

The server ships with a minimal, modern single-page UI served from `public/`
at the root URL. It provides:

- A landing page with a **Sign in with GitHub** button
- An **install** prompt that links to the GitHub App installation page once
  you're signed in (used when no repositories are linked yet)
- A **dashboard** to browse linked repositories and create, edit, change the
  status of, and delete issues

## API Endpoints

### Authentication

| Method | Path             | Description                                  |
| ------ | ---------------- | -------------------------------------------- |
| GET    | `/auth/login`    | Redirect to GitHub OAuth                     |
| GET    | `/auth/callback` | OAuth callback (exchanges code, redirects /) |
| GET    | `/auth/install`  | Redirect to the GitHub App install page      |
| POST   | `/auth/logout`   | Destroy session                              |
| GET    | `/auth/me`       | Get current authenticated user               |

### Repositories

| Method | Path               | Description                             |
| ------ | ------------------ | --------------------------------------- |
| GET    | `/repositories`    | List all linked repositories            |
| GET    | `/repositories/:id`| Get a single repository                 |

Repositories are managed automatically via GitHub App installation webhooks.

### Issues

| Method | Path          | Description                                      |
| ------ | ------------- | ------------------------------------------------ |
| GET    | `/issues`     | List issues (filter: `?repositoryId=&status=`)   |
| GET    | `/issues/:id` | Get a single issue                               |
| POST   | `/issues`     | Create an issue (`{ title, description?, repositoryId }`) |
| PATCH  | `/issues/:id` | Update an issue (`{ title?, description?, status? }`)     |
| DELETE | `/issues/:id` | Delete an issue                                  |

Issue statuses: `OPEN`, `IN_PROGRESS`, `CLOSED`

### Webhooks

| Method | Path                | Description              |
| ------ | ------------------- | ------------------------ |
| POST   | `/webhooks/github`  | GitHub App webhook receiver |

### Health

| Method | Path           | Description                                   |
| ------ | -------------- | --------------------------------------------- |
| GET    | `/health`      | Health check                                  |
| GET    | `/csrf-token`  | Get a CSRF token for state-changing requests  |

> **Note**: All `POST`, `PATCH`, and `DELETE` requests (except webhooks) require a valid `X-CSRF-Token` header. Obtain a token from `GET /csrf-token`.

## Data Model

- **User** – GitHub user, created on first OAuth login
- **Installation** – A GitHub App installation (on a user or org account)
- **Repository** – A GitHub repository linked via an installation
- **Issue** – An issue linked to a repository, created by a user
