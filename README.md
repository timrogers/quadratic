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
| POST   | `/api/logout`    | Destroy session                              |
| GET    | `/api/me`        | Get current authenticated user               |

### Repositories

| Method | Path                   | Description                             |
| ------ | ---------------------- | --------------------------------------- |
| GET    | `/api/repositories`    | List all linked repositories            |
| GET    | `/api/repositories/:id`| Get a single repository                 |

Repositories are managed automatically via GitHub App installation webhooks.

### Issues

| Method | Path              | Description                                      |
| ------ | ----------------- | ------------------------------------------------ |
| GET    | `/api/issues`     | List issues (filter: `?repositoryId=&status=`)   |
| GET    | `/api/issues/:id` | Get a single issue                               |
| POST   | `/api/issues`     | Create an issue (`{ title, description?, repositoryId }`) |
| PATCH  | `/api/issues/:id` | Update an issue (`{ title?, description?, status? }`)     |
| DELETE | `/api/issues/:id` | Delete an issue                                  |

Issue statuses: `OPEN`, `IN_PROGRESS`, `CLOSED`

The frontend exposes per-issue permalink pages at `/issues/:id` (HTML, served by the SPA).

### External API (bearer token)

| Method | Path                       | Description                                    |
| ------ | -------------------------- | ---------------------------------------------- |
| GET    | `/api/external/issues`     | List issues for the token's repository         |
| GET    | `/api/external/issues/:id` | Get a single issue from the token's repository |

Requires an OIDC-issued bearer token scoped to a single repository.

### MCP server

| Method | Path   | Description                                              |
| ------ | ------ | -------------------------------------------------------- |
| POST   | `/mcp` | [Model Context Protocol](https://modelcontextprotocol.io) endpoint (Streamable HTTP, stateless) |

Authenticated with the same OIDC-issued bearer tokens as the External API
(`Authorization: Bearer <token>`). The token's repository scope is enforced for
every tool call. Exposes five tools:

| Tool             | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `list_issues`    | List issues in the token's repository, optionally filtered by status.       |
| `get_issue`      | Get a single issue by id.                                                   |
| `create_issue`   | Create a new issue. The author is the user identified by the token's actor. |
| `update_issue`   | Update an issue's title, description and/or status.                         |
| `delete_issues`  | Delete an issue by id.                                                      |

### Webhooks

| Method | Path                | Description              |
| ------ | ------------------- | ------------------------ |
| POST   | `/webhooks/github`  | GitHub App webhook receiver |

### Health

| Method | Path              | Description                                   |
| ------ | ----------------- | --------------------------------------------- |
| GET    | `/health`         | Health check                                  |
| GET    | `/api/csrf-token` | Get a CSRF token for state-changing requests  |

> **Note**: All `POST`, `PATCH`, and `DELETE` requests (except webhooks and the `/api/external/` bearer-token API) require a valid `X-CSRF-Token` header. Obtain a token from `GET /api/csrf-token`.

## Data Model

- **User** – GitHub user, created on first OAuth login
- **Installation** – A GitHub App installation (on a user or org account)
- **Repository** – A GitHub repository linked via an installation
- **Issue** – An issue linked to a repository, created by a user
