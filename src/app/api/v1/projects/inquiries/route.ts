import { NextResponse } from "next/server";
import { authenticateApiKey, hasPermission } from "@/lib/apiKeys/keys";
import { consumeRateLimit } from "@/lib/portal/rate-limit";
import { InquiryConflictError, createProjectInquiry, inquirySchema } from "@/modules/integrations/projectInquiries";

const MAX_BODY_BYTES = 16 * 1024;

function errorResponse(status: number, error: string) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  const apiKey = await authenticateApiKey(request.headers.get("authorization"));
  if (!apiKey) return errorResponse(401, "Missing or invalid API key.");
  if (!hasPermission(apiKey, "PROJECT_INQUIRIES_CREATE")) return errorResponse(403, "This API key cannot create project inquiries.");

  if (!consumeRateLimit(`api:inquiries:${apiKey.id}`, 20, 15 * 60_000)) return errorResponse(429, "Too many requests. Please try again later.");

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) return errorResponse(413, "Request body is too large.");

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return errorResponse(413, "Request body is too large.");

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }

  const parsed = inquirySchema.safeParse(body);
  if (!parsed.success) return errorResponse(400, parsed.error.issues.map((issue) => issue.message).join(" "));

  try {
    const result = await createProjectInquiry(apiKey, parsed.data);
    return NextResponse.json({ success: true, project: result.project, duplicate: result.duplicate }, { status: result.status });
  } catch (error) {
    if (error instanceof InquiryConflictError) return errorResponse(409, error.message);
    console.error("Project inquiry submission failed.", { apiKeyId: apiKey.id, error: error instanceof Error ? error.message : error });
    return errorResponse(500, "The inquiry could not be processed.");
  }
}
