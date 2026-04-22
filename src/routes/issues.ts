import { Router, Request, Response } from "express";
import { IssueStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();

const VALID_STATUSES: IssueStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED"];

// List issues, optionally filtered by repository and/or status
router.get("/", requireAuth, async (req: Request, res: Response) => {
  const { repositoryId, status } = req.query;

  const where: Record<string, unknown> = {};
  if (repositoryId) {
    const repoId = parseInt(repositoryId as string, 10);
    if (isNaN(repoId)) {
      res.status(400).json({ error: "Invalid repositoryId" });
      return;
    }
    where.repositoryId = repoId;
  }
  if (status) {
    if (!VALID_STATUSES.includes(status as IssueStatus)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    where.status = status;
  }

  const issues = await prisma.issue.findMany({
    where,
    include: {
      author: { select: { id: true, login: true, name: true } },
      repository: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json(issues);
});

// Get a single issue by ID
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid issue ID" });
    return;
  }

  const issue = await prisma.issue.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, login: true, name: true } },
      repository: { select: { id: true, fullName: true } },
    },
  });

  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  res.json(issue);
});

// Create a new issue
router.post("/", requireAuth, async (req: Request, res: Response) => {
  const { title, description, repositoryId } = req.body;

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  if (!repositoryId || typeof repositoryId !== "number") {
    res.status(400).json({ error: "repositoryId is required and must be a number" });
    return;
  }

  // Verify the repository exists
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const issue = await prisma.issue.create({
    data: {
      title: title.trim(),
      description: description || null,
      repositoryId,
      authorId: req.session.userId!,
    },
    include: {
      author: { select: { id: true, login: true, name: true } },
      repository: { select: { id: true, fullName: true } },
    },
  });

  res.status(201).json(issue);
});

// Update an issue
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid issue ID" });
    return;
  }

  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const data: Record<string, unknown> = {};
  const { title, description, status } = req.body;

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      res.status(400).json({ error: "Title must be a non-empty string" });
      return;
    }
    data.title = title.trim();
  }

  if (description !== undefined) {
    data.description = description;
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    data.status = status;
  }

  const issue = await prisma.issue.update({
    where: { id },
    data,
    include: {
      author: { select: { id: true, login: true, name: true } },
      repository: { select: { id: true, fullName: true } },
    },
  });

  res.json(issue);
});

// Delete an issue
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid issue ID" });
    return;
  }

  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  await prisma.issue.delete({ where: { id } });
  res.status(204).send();
});

export default router;
