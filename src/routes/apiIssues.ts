import { Router, Request, Response } from "express";
import { IssueStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireRepositoryToken } from "../middleware/bearerToken";

const router = Router();

const VALID_STATUSES: IssueStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED"];

// All routes under /api/issues require an OIDC-issued bearer token.
// The token's `repositoryId` is the only repository the caller can see.
router.use(requireRepositoryToken);

router.get("/", async (req: Request, res: Response) => {
  const repositoryId = req.issuedToken!.repositoryId;
  const { status } = req.query;

  const where: Record<string, unknown> = { repositoryId };
  if (status) {
    if (!VALID_STATUSES.includes(status as IssueStatus)) {
      res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
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

router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid issue ID" });
    return;
  }

  const issue = await prisma.issue.findFirst({
    where: { id, repositoryId: req.issuedToken!.repositoryId },
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

export default router;
