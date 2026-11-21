import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { generateApiKey } from "../src/lib/apiKeys/keys";

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function usage(): never {
  console.log(`Usage:
  tsx prisma/manage-api-keys.ts create --name "ACS Website" --source acs-website [--organization-id <id>]
  tsx prisma/manage-api-keys.ts list [--organization-id <id>]
  tsx prisma/manage-api-keys.ts revoke --id <apiKeyId>
`);
  process.exit(1);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const [command, ...rest] = process.argv.slice(2);

  try {
    if (command === "create") {
      const name = flag(rest, "name");
      const source = flag(rest, "source");
      const organizationId = flag(rest, "organization-id");
      if (!name || !source) usage();
      const organization = organizationId
        ? await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })
        : await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
      const { key, hash, prefix } = generateApiKey();
      const created = await prisma.apiKey.create({
        data: { organizationId: organization.id, name, keyHash: hash, keyPrefix: prefix, permissions: ["PROJECT_INQUIRIES_CREATE"], defaultSource: source },
      });
      console.log(`API key created for "${name}" (organization: ${organization.name}).`);
      console.log(`Key ID: ${created.id}`);
      console.log(`Plaintext key (shown once, store it securely now):\n${key}`);
    } else if (command === "list") {
      const organizationId = flag(rest, "organization-id");
      const keys = await prisma.apiKey.findMany({ where: organizationId ? { organizationId } : undefined, orderBy: { createdAt: "desc" } });
      if (!keys.length) {
        console.log("No API keys found.");
        return;
      }
      for (const k of keys) {
        console.log(`${k.id}  ${k.revokedAt ? "REVOKED" : "ACTIVE "}  ${k.keyPrefix}…  ${k.name}  source=${k.defaultSource}  permissions=${k.permissions.join(",")}  lastUsed=${k.lastUsedAt?.toISOString() ?? "never"}`);
      }
    } else if (command === "revoke") {
      const id = flag(rest, "id");
      if (!id) usage();
      const existing = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
      if (existing.revokedAt) {
        console.log(`API key ${id} is already revoked.`);
        return;
      }
      await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      console.log(`API key ${id} (${existing.name}) revoked.`);
    } else {
      usage();
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
