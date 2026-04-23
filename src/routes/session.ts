import { Router, Request, Response } from "express";
import { prisma } from "../db";

const router = Router();

// Get current authenticated user (returns 401 when no session)
router.get("/me", async (req: Request, res: Response) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: {
      id: true,
      login: true,
      name: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

// Destroy session
router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    res.json({ message: "Logged out successfully" });
  });
});

export default router;
