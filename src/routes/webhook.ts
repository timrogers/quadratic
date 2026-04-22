import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../db";
import { config } from "../config";

const router = Router();

/**
 * Parse the owner from a GitHub full_name (e.g. "octocat/hello-world" → "octocat").
 */
function parseOwner(fullName: string): string {
  const slashIndex = fullName.indexOf("/");
  if (slashIndex <= 0) {
    throw new Error(`Invalid repository full_name: ${fullName}`);
  }
  return fullName.substring(0, slashIndex);
}

/**
 * Verify the webhook signature from GitHub to ensure authenticity.
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", config.github.webhookSecret)
      .update(payload)
      .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Handle GitHub App webhook events.
 *
 * - `installation.created` — a user installed the App; record the installation.
 * - `installation.deleted` — a user uninstalled the App; remove the installation.
 * - `installation_repositories.added` — repos were added to an existing installation.
 * - `installation_repositories.removed` — repos were removed from an existing installation.
 */
router.post("/", async (req: Request, res: Response) => {
  const payload = JSON.stringify(req.body);
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!verifyWebhookSignature(payload, signature)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const event = req.headers["x-github-event"] as string;

  try {
    if (event === "installation") {
      await handleInstallationEvent(req.body);
    } else if (event === "installation_repositories") {
      await handleInstallationRepositoriesEvent(req.body);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

interface InstallationPayload {
  action: string;
  installation: {
    id: number;
    account: { login: string; type: string };
  };
  repositories?: Array<{ id: number; full_name: string; name: string }>;
}

async function handleInstallationEvent(body: InstallationPayload): Promise<void> {
  const { action, installation, repositories } = body;

  if (action === "created") {
    const inst = await prisma.installation.create({
      data: {
        githubInstallationId: installation.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      },
    });

    if (repositories && repositories.length > 0) {
      await prisma.repository.createMany({
        data: repositories.map((repo) => ({
          githubId: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          owner: parseOwner(repo.full_name),
          installationId: inst.id,
        })),
      });
    }
  } else if (action === "deleted") {
    // Cascade delete will remove associated repositories (and their issues)
    await prisma.installation.delete({
      where: { githubInstallationId: installation.id },
    }).catch(() => {
      // Installation may not exist locally; ignore
    });
  }
}

interface InstallationRepositoriesPayload {
  action: string;
  installation: { id: number };
  repositories_added?: Array<{ id: number; full_name: string; name: string }>;
  repositories_removed?: Array<{ id: number }>;
}

async function handleInstallationRepositoriesEvent(
  body: InstallationRepositoriesPayload,
): Promise<void> {
  const { action, installation, repositories_added, repositories_removed } = body;

  const inst = await prisma.installation.findUnique({
    where: { githubInstallationId: installation.id },
  });

  if (!inst) {
    console.warn(`Installation ${installation.id} not found locally`);
    return;
  }

  if (action === "added" && repositories_added) {
    await prisma.repository.createMany({
      data: repositories_added.map((repo) => ({
        githubId: repo.id,
        fullName: repo.full_name,
        name: repo.name,
        owner: parseOwner(repo.full_name),
        installationId: inst.id,
      })),
      skipDuplicates: true,
    });
  } else if (action === "removed" && repositories_removed) {
    await prisma.repository.deleteMany({
      where: {
        githubId: { in: repositories_removed.map((r) => r.id) },
      },
    });
  }
}

export default router;
