# Quadratic – Minimal Issue Tracker

A minimal issue tracking tool built with TypeScript, Express, and Prisma (Postgres). Issues are linked to GitHub repositories via a GitHub App, and users log in with GitHub OAuth.

## Architecture

- **Authentication**: GitHub OAuth (via a GitHub App's OAuth flow)
- **Repository linking**: A GitHub App is installed on repositories; webhook events sync installations and repositories
- **Database**: PostgreSQL with Prisma ORM
- **API**: RESTful JSON API built with Express

## Prerequisites

- Node.js 20+
- PostgreSQL database
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with:
  - **OAuth** enabled (Client ID + Client Secret)
  - **Webhook URL** pointed at `<your-base-url>/webhooks/github`
  - **Webhook secret** configured
  - Permissions: `Repository metadata: Read-only`
  - Subscribe to events: `Installation`, `Installation repositories`

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   # Edit .env with your database URL, GitHub App credentials, etc.
   ```

3. **Run database migrations**

   ```bash
   npm run db:push
   ```

4. **Start the server**

   ```bash
   # Development
   npm run dev

   # Production
   npm run build
   npm start
   ```

## API Endpoints

### Authentication

| Method | Path             | Description                        |
| ------ | ---------------- | ---------------------------------- |
| GET    | `/auth/login`    | Redirect to GitHub OAuth           |
| GET    | `/auth/callback` | OAuth callback (exchanges code)    |
| POST   | `/auth/logout`   | Destroy session                    |
| GET    | `/auth/me`       | Get current authenticated user     |

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

| Method | Path      | Description   |
| ------ | --------- | ------------- |
| GET    | `/health` | Health check  |

## Data Model

- **User** – GitHub user, created on first OAuth login
- **Installation** – A GitHub App installation (on a user or org account)
- **Repository** – A GitHub repository linked via an installation
- **Issue** – An issue linked to a repository, created by a user
