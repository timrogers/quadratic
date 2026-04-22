import { Router, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { IssuedToken, IssueStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireRepositoryToken } from "../middleware/bearerToken";
import { log } from "../logger";

const router = Router();

const STATUS_VALUES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
const StatusSchema = z.enum(STATUS_VALUES);

function ok(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const ISSUE_INCLUDE = {
  author: { select: { id: true, login: true, name: true } },
  repository: { select: { id: true, fullName: true } },
} as const;

// Resolve the user that should own MCP-created issues. We look up by the
// OIDC `actor` claim recorded on the issued token (interpreted as a GitHub
// login). If no actor is recorded, or the login does not match a known
// user, creation fails with a clear error.
async function resolveAuthorId(token: IssuedToken): Promise<number | null> {
  if (!token.actor) return null;
  const user = await prisma.user.findFirst({
    where: { login: token.actor },
    select: { id: true },
  });
  return user?.id ?? null;
}

function buildMcpServer(token: IssuedToken): McpServer {
  const server = new McpServer(
    { name: "quadratic-mcp", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools for managing issues in a single Quadratic repository. " +
        "All tools operate on the repository scoped by the bearer token.",
    },
  );

  server.registerTool(
    "list_issues",
    {
      description:
        "List issues in this repository, optionally filtered by status.",
      inputSchema: {
        status: StatusSchema.optional().describe(
          "Filter by status: OPEN, IN_PROGRESS, or CLOSED.",
        ),
      },
    },
    async ({ status }) => {
      const issues = await prisma.issue.findMany({
        where: {
          repositoryId: token.repositoryId,
          ...(status ? { status: status as IssueStatus } : {}),
        },
        include: ISSUE_INCLUDE,
        orderBy: { createdAt: "desc" },
      });
      return ok(issues);
    },
  );

  server.registerTool(
    "get_issue",
    {
      description: "Get a single issue in this repository by its numeric id.",
      inputSchema: {
        id: z.number().int().positive().describe("The issue id."),
      },
    },
    async ({ id }) => {
      const issue = await prisma.issue.findFirst({
        where: { id, repositoryId: token.repositoryId },
        include: ISSUE_INCLUDE,
      });
      if (!issue) return fail(`Issue ${id} not found in this repository.`);
      return ok(issue);
    },
  );

  server.registerTool(
    "create_issue",
    {
      description: "Create a new issue in this repository.",
      inputSchema: {
        title: z.string().trim().min(1).max(255).describe("Issue title."),
        description: z
          .string()
          .nullish()
          .describe("Optional issue description."),
      },
    },
    async ({ title, description }) => {
      const authorId = await resolveAuthorId(token);
      if (!authorId) {
        return fail(
          "Cannot create issue: the token's actor does not match any " +
            "known user. Sign in to Quadratic with the GitHub account " +
            "matching the OIDC actor claim, then retry.",
        );
      }
      const issue = await prisma.issue.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          repositoryId: token.repositoryId,
          authorId,
        },
        include: ISSUE_INCLUDE,
      });
      return ok(issue);
    },
  );

  server.registerTool(
    "update_issue",
    {
      description:
        "Update an issue's title, description and/or status. Only fields you supply are changed.",
      inputSchema: {
        id: z.number().int().positive().describe("The issue id."),
        title: z.string().trim().min(1).max(255).optional(),
        description: z.string().nullish(),
        status: StatusSchema.optional(),
      },
    },
    async ({ id, title, description, status }) => {
      const existing = await prisma.issue.findFirst({
        where: { id, repositoryId: token.repositoryId },
        select: { id: true },
      });
      if (!existing) return fail(`Issue ${id} not found in this repository.`);

      const data: Record<string, unknown> = {};
      if (title !== undefined) data.title = title.trim();
      if (description !== undefined)
        data.description = description?.trim() || null;
      if (status !== undefined) data.status = status as IssueStatus;

      if (Object.keys(data).length === 0) {
        return fail(
          "No fields to update. Provide at least one of title, description, or status.",
        );
      }

      const updated = await prisma.issue.update({
        where: { id },
        data,
        include: ISSUE_INCLUDE,
      });
      return ok(updated);
    },
  );

  server.registerTool(
    "delete_issues",
    {
      description: "Delete an issue in this repository by its numeric id.",
      inputSchema: {
        id: z.number().int().positive().describe("The issue id."),
      },
    },
    async ({ id }) => {
      const existing = await prisma.issue.findFirst({
        where: { id, repositoryId: token.repositoryId },
        select: { id: true },
      });
      if (!existing) return fail(`Issue ${id} not found in this repository.`);
      await prisma.issue.delete({ where: { id } });
      return ok({ deleted: true, id });
    },
  );

  return server;
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const token = req.issuedToken!;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: a fresh server per request
  });
  const server = buildMcpServer(token);

  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error("mcp.request.failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

// In stateless mode the transport handles POST (JSON-RPC requests) and
// rejects GET/DELETE (which are only meaningful for stateful sessions).
router.post("/", requireRepositoryToken, handleMcpRequest);
router.get("/", requireRepositoryToken, handleMcpRequest);
router.delete("/", requireRepositoryToken, handleMcpRequest);

export default router;
