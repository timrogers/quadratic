import { Router, Request, Response } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { log } from "../logger";

const router = Router();

// Step 1: Redirect user to GitHub OAuth authorization page
router.get("/login", (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    client_id: config.github.clientId,
    redirect_uri: `${config.baseUrl}/auth/callback`,
    scope: "read:user",
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

// Step 2: Handle the OAuth callback from GitHub
router.get("/callback", async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: config.github.clientId,
          client_secret: config.github.clientSecret,
          code,
        }),
      },
    );

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      res.status(400).json({ error: "Failed to obtain access token" });
      return;
    }

    // Fetch user profile from GitHub
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github+json",
      },
    });

    const userData = (await userResponse.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };

    // Upsert user in database
    const user = await prisma.user.upsert({
      where: { githubId: userData.id },
      update: {
        login: userData.login,
        name: userData.name,
        avatarUrl: userData.avatar_url,
        accessToken: tokenData.access_token,
      },
      create: {
        githubId: userData.id,
        login: userData.login,
        name: userData.name,
        avatarUrl: userData.avatar_url,
        accessToken: tokenData.access_token,
      },
    });

    // Store user ID in session
    req.session.userId = user.id;
    res.redirect("/");
  } catch (error) {
    log.error("auth.oauth_callback.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Redirect to the GitHub App's installation page
router.get("/install", (_req: Request, res: Response) => {
  res.redirect(
    `https://github.com/apps/${encodeURIComponent(config.github.appSlug)}/installations/new`,
  );
});

export default router;
