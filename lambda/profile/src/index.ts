import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from "aws-lambda";

// Invoked through a Lambda Function URL. CORS (including OPTIONS preflight)
// is configured on the Function URL itself, so no CORS headers are set here.

const TABLE_NAME = process.env.TABLE_NAME ?? "PinterestUsers";
const USER_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProfileInput {
  userId: string;
  displayName?: string;
  email?: string;
  bio?: string;
  interests?: string[];
}

const json = (statusCode: number, body: unknown): LambdaFunctionURLResult => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const trimmed = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

async function getProfile(userId: string): Promise<LambdaFunctionURLResult> {
  const result = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: { userId } }));
  if (!result.Item) {
    return json(404, { error: `No profile found for "${userId}"` });
  }
  return json(200, { profile: result.Item });
}

async function saveProfile(input: ProfileInput): Promise<LambdaFunctionURLResult> {
  const now = new Date().toISOString();
  const interests = Array.isArray(input.interests)
    ? input.interests.map((i) => trimmed(i, 40)).filter(Boolean).slice(0, 20)
    : [];

  const result = await db.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { userId: input.userId },
      UpdateExpression:
        "SET displayName = :displayName, email = :email, bio = :bio, interests = :interests, " +
        "updatedAt = :now, createdAt = if_not_exists(createdAt, :now)",
      ExpressionAttributeValues: {
        ":displayName": trimmed(input.displayName, 100),
        ":email": trimmed(input.email, 254),
        ":bio": trimmed(input.bio, 500),
        ":interests": interests,
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return json(200, { profile: result.Attributes });
}

export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const method = event.requestContext.http.method;

  try {
    if (method === "GET") {
      const userId = event.queryStringParameters?.userId ?? "";
      if (!USER_ID_PATTERN.test(userId)) {
        return json(400, { error: "A valid userId query parameter is required" });
      }
      return await getProfile(userId);
    }

    if (method === "PUT" || method === "POST") {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "";
      let input: ProfileInput;
      try {
        input = JSON.parse(raw);
      } catch {
        return json(400, { error: "Request body must be valid JSON" });
      }
      if (!USER_ID_PATTERN.test(input?.userId ?? "")) {
        return json(400, {
          error: "userId is required (1-64 letters, numbers, '.', '_' or '-')",
        });
      }
      return await saveProfile(input);
    }

    return json(405, { error: `Method ${method} not allowed` });
  } catch (err) {
    console.error("Profile request failed:", err);
    return json(500, { error: "Internal server error" });
  }
}
