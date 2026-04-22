import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

const router = Router();

// List all repositories linked via GitHub App installations
router.get("/", requireAuth, async (_req: Request, res: Response) => {
  const repositories = await prisma.repository.findMany({
    include: { installation: { select: { accountLogin: true, accountType: true } } },
    orderBy: { fullName: "asc" },
  });

  res.json(repositories);
});

// Get a single repository by ID
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid repository ID" });
    return;
  }

  const repository = await prisma.repository.findUnique({
    where: { id },
    include: {
      installation: { select: { accountLogin: true, accountType: true } },
      _count: { select: { issues: true } },
    },
  });

  if (!repository) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  res.json(repository);
});

export default router;
